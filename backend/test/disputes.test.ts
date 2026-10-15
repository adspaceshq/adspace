import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { disputes, settlements, spots } from "../src/db/schema.js";
import { raiseDispute, resolveDispute, timeoutDispute, withdrawDispute, type DisputeDeps } from "../src/services/disputes.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
const REASON = "the sticker was never placed on the laptop";

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let timeoutSeconds: number;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  timeoutSeconds = 3 * 24 * 60 * 60;
});

const reviewerKey = keypairSigner(Keypair.generate());
const deps = (now = new Date()): DisputeDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  feePayer: reviewerKey,
  resolver: reviewerKey,
  rentPayer: reviewerKey,
  runTx: fakeRunTx(db, sent),
  readListingSnapshot: async () => ({
    treasury: Keypair.generate().publicKey,
    fees: { mode: "fixed", feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 },
  }),
  readVaultBalance: async () => 100n * USDC,
  accountExists: async () => true,
  readDisputeTimeoutSeconds: async () => timeoutSeconds,
  listingBaseUrl: "https://adspaces.fun",
  now: () => now,
});

// Delivery deadline passed one hour ago; spot funded without proof.
async function overdueSpot() {
  return seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
}

test("buyer raises a dispute after the delivery deadline", async () => {
  const { buyer, spot } = await overdueSpot();
  const result = await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(result.spot.state, "disputed");
  assert.equal(result.dispute.state, "open");
  assert.equal(sent[0].op, "raise_dispute");
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [buyer!.signer.publicKey.toBase58()]);
});

test("a separate platform rent payer co-signs the dispute and receives rent on timeout", async () => {
  const { buyer, spot, seller } = await overdueSpot();
  const rentPayer = keypairSigner(Keypair.generate());
  const withRentPayer = (now?: Date) => ({ ...deps(now), rentPayer });
  await raiseDispute(withRentPayer(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [buyer!.signer.publicKey.toBase58(), rentPayer.publicKey.toBase58()]);
  timeoutSeconds = 0;
  await timeoutDispute(withRentPayer(), spot.id);
  const keys = sent[1].instructions.at(-1)!.keys;
  assert.ok(keys.some((key) => key.pubkey.equals(rentPayer.publicKey) && key.isWritable));
  // The creator's wallet is no longer part of a timeout.
  assert.ok(!keys.some((key) => key.pubkey.toBase58() === seller.user.walletAddress));
});

test("disputes are blocked before delivery is due, for non-buyers, and with thin reasons", async () => {
  const early = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 24 * HOUR),
    funded: true,
  });
  await assert.rejects(raiseDispute(deps(), early.buyer!.user.id, early.buyer!.signer, early.spot.id, { reason: REASON }), /after the delivery deadline/);
  const { seller, buyer, spot } = await overdueSpot();
  await assert.rejects(raiseDispute(deps(), seller.user.id, seller.signer, spot.id, { reason: REASON }), /only the sponsor/);
  await assert.rejects(raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: "bad" }), /10-2000/);
  assert.equal(sent.length, 0);
});

test("a withdrawn dispute returns the spot and can be raised again", async () => {
  const { buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  const withdrawn = await withdrawDispute(deps(), buyer!.user.id, buyer!.signer, spot.id);
  assert.equal(withdrawn.spot.state, "funded");
  const again = await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(again.spot.state, "disputed");
  assert.deepEqual(sent.map((tx) => tx.idempotencyKey.split(":")[0]), ["dispute", "withdraw-dispute", "dispute"]);
  const history = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.deepEqual(history.map((row) => row.state).sort(), ["open", "withdrawn"]);
});

test("reviewers resolve with a split that adds up; parties can't resolve", async () => {
  const { seller, buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  const decision = { sellerShareBps: 5000, decision: "half delivered, photos show partial placement" };
  await assert.rejects(resolveDispute(deps(), seller.user.id, spot.id, decision), /part of/);
  await assert.rejects(resolveDispute(deps(), buyer!.user.id, spot.id, decision), /part of/);
  const reviewer = await seedUser(db, "reviewer");
  const result = await resolveDispute(deps(), reviewer.user.id, spot.id, decision);
  assert.equal(result.spot.state, "settled");
  const { gross, fee, sellerNet, buyerRefund } = result.settlement;
  assert.equal(fee + sellerNet + buyerRefund, gross);
  assert.equal(buyerRefund, 50n * USDC);
  assert.equal(fee, 25n * USDC / 10n);
  const [closed] = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.equal(closed.state, "resolved");
  assert.equal(closed.resolvedBy, reviewer.user.id);
});

test("unresolved disputes refund the buyer once the configured timeout passes", async () => {
  const { buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  await assert.rejects(timeoutDispute(deps(), spot.id), /auto-refund opens/);
  timeoutSeconds = 60;
  const result = await timeoutDispute(deps(new Date(Date.now() + 61_000)), spot.id);
  assert.equal(result.spot.state, "refunded");
  assert.equal(result.settlement.buyerRefund, 100n * USDC);
  assert.equal(result.settlement.fee, 0n);
  const [stored] = await db.select().from(settlements).where(eq(settlements.spotId, spot.id));
  assert.equal(stored.kind, "timeout_refund");
  const [refunded] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(refunded.state, "refunded");
});
