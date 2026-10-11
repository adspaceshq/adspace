import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { bids, chainTxs, settlements, spots } from "../src/db/schema.js";
import { listingLedger, searchListings } from "../src/services/ledger.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;
before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

const tx = async (op: "place_bid" | "resolve_dispute", spotId: string, at: Date) =>
  (await db.insert(chainTxs).values({ op, idempotencyKey: `k-${randomUUID()}`, spotId, status: "confirmed", signature: `s-${randomUUID()}`, confirmedAt: at, createdAt: at }).returning())[0];

test("ledger traces bids, outbid refunds and a dispute split, and checks escrow balances", async () => {
  const { listing, spot, seller } = await seedListing(db, { mode: "auction", deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const alice = await seedUser(db, "alice");
  const bob = await seedUser(db, "bob");
  const t0 = Date.now() - 5 * HOUR;
  const first = await tx("place_bid", spot.id, new Date(t0));
  const second = await tx("place_bid", spot.id, new Date(t0 + HOUR));
  await db.insert(bids).values([
    { spotId: spot.id, bidderId: alice.user.id, bidderWallet: alice.user.walletAddress!, amount: 100n * USDC, chainTxId: first.id, createdAt: new Date(t0) },
    { spotId: spot.id, bidderId: bob.user.id, bidderWallet: bob.user.walletAddress!, amount: 120n * USDC, chainTxId: second.id, createdAt: new Date(t0 + HOUR) },
  ]);
  const split = await tx("resolve_dispute", spot.id, new Date(t0 + 2 * HOUR));
  await db.insert(settlements).values({ spotId: spot.id, kind: "dispute_split", gross: 120n * USDC, fee: 3n * USDC, sellerNet: 57n * USDC, buyerRefund: 60n * USDC, chainTxId: split.id });
  await db.update(spots).set({ state: "settled", buyerId: bob.user.id, buyerWallet: bob.user.walletAddress!, amount: 120n * USDC }).where(eq(spots.id, spot.id));

  const ledger = (await listingLedger(db, listing.id, "Treasury111"))!;
  assert.deepEqual(ledger.totals, { sponsorsPaid: 220n * USDC, refundedToSponsors: 160n * USDC, creatorEarned: 57n * USDC, platformFees: 3n * USDC, heldInEscrow: 0n });
  assert.equal(ledger.spots[0].balanced, true);
  const outbid = ledger.entries.find((entry) => entry.id === second.id)!;
  assert.deepEqual(outbid.moves.filter((move) => move.party === "sponsor").map((move) => [move.handle, move.amount]), [
    [bob.user.handle, -120n * USDC],
    [alice.user.handle, 100n * USDC],
  ]);
  assert.equal(ledger.flags.length, 0);
  assert.equal(ledger.listing.seller.handle, seller.user.handle);

  // A finished spot that still "holds" money is flagged.
  await db.delete(settlements).where(eq(settlements.chainTxId, split.id));
  const broken = (await listingLedger(db, listing.id, null))!;
  assert.equal(broken.spots[0].balanced, false);
  assert.match(broken.flags[0].message, /escrow holds/);

  assert.equal((await searchListings(db, seller.user.handle))[0].id, listing.id);
  assert.equal((await searchListings(db, listing.id))[0].id, listing.id);
  assert.equal(await listingLedger(db, "00000000-0000-0000-0000-000000000000", null), undefined);
});
