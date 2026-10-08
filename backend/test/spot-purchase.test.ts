import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { bids, chainTxs, listings, spotEvents, spots, users } from "../src/db/schema.js";
import { claimSpot, minimumBid, placeBid, PurchaseError, type PurchaseDeps } from "../src/services/spot-purchase.js";
import { createTestDb } from "./helpers/db.js";

const USDC = 1_000_000n;
const NOW = new Date("2026-10-08T12:00:00Z");
const DEADLINE = new Date("2026-10-10T12:00:00Z");

let db: Db;
let close: () => Promise<void>;
let sentTxs: ChainTxRequest[];
let chainDeadline: Date;
let failNextTx: Error | null;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sentTxs = [];
  chainDeadline = DEADLINE;
  failNextTx = null;
});

const deps = (): PurchaseDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  feePayer: keypairSigner(Keypair.generate()),
  now: () => NOW,
  fetchListingDeadline: async () => chainDeadline,
  runTx: async (request) => {
    if (failNextTx) throw failNextTx;
    sentTxs.push(request);
    const signature = `sig-${randomUUID()}`;
    const [row] = await db
      .insert(chainTxs)
      .values({
        op: request.op,
        idempotencyKey: request.idempotencyKey,
        spotId: request.spotId,
        status: "confirmed",
        signature,
        confirmedAt: NOW,
      })
      .returning();
    return { chainTxId: row.id, signature };
  },
});

async function createUser(handle: string) {
  const keypair = Keypair.generate();
  const [user] = await db
    .insert(users)
    .values({
      privyDid: `did:privy:${handle}`,
      handle,
      displayName: handle,
      walletAddress: keypair.publicKey.toBase58(),
    })
    .returning();
  return { user, purchaser: { id: user.id, signer: keypairSigner(keypair) } };
}

async function createSpot(mode: "fixed" | "auction", options: { doubleUp?: boolean } = {}) {
  const seller = await createUser(`seller_${randomUUID().slice(0, 8)}`);
  const auction = mode === "auction";
  const [listing] = await db
    .insert(listings)
    .values({
      slug: `listing-${randomUUID()}`,
      sellerId: seller.user.id,
      surface: "laptop",
      title: "test laptop",
      mode,
      state: "published",
      deadline: DEADLINE,
      artworkDueAt: DEADLINE,
      deliveryDueAt: new Date("2026-10-17T12:00:00Z"),
      minIncrement: auction && !options.doubleUp ? 10n * USDC : 0n,
      doubleUp: options.doubleUp ?? false,
      feeBps: auction ? 250 : 500,
      upliftFeeBps: auction ? 2000 : 0,
      maxFeeBps: auction ? 1000 : 500,
      chainAddress: Keypair.generate().publicKey.toBase58(),
      sellerWallet: seller.user.walletAddress,
    })
    .returning();
  const [spot] = await db
    .insert(spots)
    .values({
      listingId: listing.id,
      index: 0,
      price: 100n * USDC,
      layout: { x: 0, y: 0, w: 10 },
      chainAddress: Keypair.generate().publicKey.toBase58(),
      vaultAddress: Keypair.generate().publicKey.toBase58(),
    })
    .returning();
  return { seller, listing, spot };
}

test("claim funds a fixed spot and records the event", async () => {
  const { spot } = await createSpot("fixed");
  const { purchaser } = await createUser(`buyer_${randomUUID().slice(0, 8)}`);
  const result = await claimSpot(deps(), spot.id, purchaser);
  assert.equal(result.spot.state, "funded");
  assert.equal(result.spot.amount, 100n * USDC);
  assert.equal(sentTxs.length, 1);
  assert.equal(sentTxs[0].idempotencyKey, `claim:${spot.id}:${purchaser.id}`);
  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.deepEqual(events.map((event) => event.type), ["claimed"]);
});

test("claim rejects the seller and taken spots before touching the chain", async () => {
  const { spot, seller } = await createSpot("fixed");
  await assert.rejects(claimSpot(deps(), spot.id, seller.purchaser), PurchaseError);
  const buyer = await createUser(`buyer_${randomUUID().slice(0, 8)}`);
  await claimSpot(deps(), spot.id, buyer.purchaser);
  const other = await createUser(`buyer_${randomUUID().slice(0, 8)}`);
  sentTxs = [];
  await assert.rejects(claimSpot(deps(), spot.id, other.purchaser), /already been taken/);
  assert.equal(sentTxs.length, 0);
});

test("a failed chain transaction leaves the spot untouched", async () => {
  const { spot } = await createSpot("fixed");
  const { purchaser } = await createUser(`buyer_${randomUUID().slice(0, 8)}`);
  failNextTx = new Error("chain rejected");
  await assert.rejects(claimSpot(deps(), spot.id, purchaser), /chain rejected/);
  const [stored] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(stored.state, "open");
  assert.equal(stored.buyerId, null);
});

test("bids enforce minimums, keep history, and track the leader", async () => {
  const { spot } = await createSpot("auction");
  const alice = await createUser(`alice_${randomUUID().slice(0, 8)}`);
  const bob = await createUser(`bob_${randomUUID().slice(0, 8)}`);

  await assert.rejects(placeBid(deps(), spot.id, alice.purchaser, 99n * USDC), /at least/);
  await placeBid(deps(), spot.id, alice.purchaser, 100n * USDC);
  await assert.rejects(placeBid(deps(), spot.id, alice.purchaser, 200n * USDC), /already hold/);
  await assert.rejects(placeBid(deps(), spot.id, bob.purchaser, 105n * USDC), /at least/);
  const result = await placeBid(deps(), spot.id, bob.purchaser, 110n * USDC);

  assert.equal(result.spot.buyerId, bob.user.id);
  assert.equal(result.spot.amount, 110n * USDC);
  const history = await db.select().from(bids).where(eq(bids.spotId, spot.id));
  assert.deepEqual(
    history.map((bid) => bid.amount),
    [100n * USDC, 110n * USDC],
  );
  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.deepEqual(events.map((event) => event.type), ["bid_placed", "outbid"]);
});

test("double-up auctions require twice the current bid", () => {
  const listing = { doubleUp: true, minIncrement: 0n };
  assert.equal(minimumBid({ price: 100n, amount: null, state: "open" }, listing), 100n);
  assert.equal(minimumBid({ price: 100n, amount: 150n, state: "funded" }, listing), 300n);
});

test("late bids sync the extended deadline from chain", async () => {
  const { spot, listing } = await createSpot("auction");
  const bidder = await createUser(`late_${randomUUID().slice(0, 8)}`);
  chainDeadline = new Date(DEADLINE.getTime() + 5 * 60 * 1000);
  const result = await placeBid(deps(), spot.id, bidder.purchaser, 100n * USDC);
  assert.equal(result.deadline.getTime(), chainDeadline.getTime());
  const [stored] = await db.select().from(listings).where(eq(listings.id, listing.id));
  assert.equal(stored.deadline.getTime(), chainDeadline.getTime());
});

test("the database rejects a funded spot without a buyer", async () => {
  const { spot } = await createSpot("fixed");
  await assert.rejects(db.update(spots).set({ state: "funded" }).where(eq(spots.id, spot.id)));
});
