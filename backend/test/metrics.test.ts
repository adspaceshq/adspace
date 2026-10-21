import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { bids, chainTxs, disputes, listings, settlements, spotEvents, spots } from "../src/db/schema.js";
import { adminMetrics } from "../src/services/metrics.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

async function confirmedTx() {
  const [row] = await db
    .insert(chainTxs)
    .values({ op: "withdraw_seller", idempotencyKey: `t:${randomUUID()}`, status: "confirmed", signature: `sig-${randomUUID()}`, confirmedAt: new Date() })
    .returning();
  return row;
}

const window = { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true };

test("admin metrics add up settlements, escrow, sales, users and health", async () => {
  // One paid out (100 USDC, 5 fee), one refunded in full, one dispute split, one still in escrow.
  const paid = await seedListing(db, window);
  const refunded = await seedListing(db, window);
  const split = await seedListing(db, window);
  const held = await seedListing(db, { ...window, mode: "auction" });
  await db.update(spots).set({ state: "settled" }).where(eq(spots.id, paid.spot.id));
  await db.update(spots).set({ state: "refunded" }).where(eq(spots.id, refunded.spot.id));
  await db.update(spots).set({ state: "settled" }).where(eq(spots.id, split.spot.id));
  await db.insert(settlements).values([
    { spotId: paid.spot.id, kind: "payout", gross: 100n * USDC, fee: 5n * USDC, sellerNet: 95n * USDC, buyerRefund: 0n, chainTxId: (await confirmedTx()).id },
    { spotId: refunded.spot.id, kind: "refund", gross: 100n * USDC, fee: 0n, sellerNet: 0n, buyerRefund: 100n * USDC, chainTxId: (await confirmedTx()).id },
    { spotId: split.spot.id, kind: "dispute_split", gross: 100n * USDC, fee: 1_250_000n, sellerNet: 48_750_000n, buyerRefund: 50n * USDC, chainTxId: (await confirmedTx()).id },
  ]);
  await db.insert(disputes).values({ spotId: split.spot.id, buyerId: split.buyer!.user.id, reason: "logo missing", state: "withdrawn" });
  // The held spot sold through two bids.
  for (const amount of [50n * USDC, 100n * USDC]) {
    await db.insert(bids).values({ spotId: held.spot.id, bidderId: held.buyer!.user.id, bidderWallet: "w", amount });
  }
  // Live for two hours before its first bid.
  await db.update(listings).set({ publishedAt: new Date(Date.now() - 2 * HOUR) }).where(eq(listings.id, held.listing.id));
  await db.insert(spotEvents).values({ spotId: held.spot.id, fromState: "open", toState: "funded", type: "bid" });
  await db.insert(chainTxs).values({ op: "claim_spot", idempotencyKey: `t:${randomUUID()}`, status: "failed", error: "x" });
  // A withdraw dialog nobody signed: abandoned, not a failure.
  await db.insert(chainTxs).values({ op: "wallet_withdrawal", idempotencyKey: `t:${randomUUID()}`, status: "failed", error: "never signed" });

  const metrics = await adminMetrics(db, { feePayerLamports: 500_000_000, minFeePayerLamports: 1_000_000_000, treasuryUsdc: 7n * USDC, escrowOnChain: 100n * USDC });

  assert.equal(metrics.money.settledGross.all, 300n * USDC);
  assert.equal(metrics.money.settledGross.last7, 300n * USDC);
  assert.equal(metrics.money.fees.all, 6_250_000n);
  assert.equal(metrics.money.creatorPayouts, 143_750_000n);
  assert.equal(metrics.money.refunds, 150n * USDC);
  assert.deepEqual(metrics.money.settlementsByKind, { payout: 1, refund: 1, dispute_split: 1 });
  assert.equal(metrics.money.escrow.amount, 100n * USDC);
  assert.equal(metrics.money.escrow.spots, 1);
  assert.equal(metrics.money.escrow.matches, true);
  assert.equal(metrics.money.treasury, 7n * USDC);

  assert.equal(metrics.marketplace.spotsSold, 4);
  assert.equal(metrics.marketplace.averageSale, 100n * USDC);
  assert.equal(metrics.marketplace.bids, 2);
  assert.equal(metrics.marketplace.averageBidsPerAuctionSpot, 2);
  assert.ok(Math.abs((metrics.marketplace.hoursToFirstSale ?? 0) - 2) < 0.1, `hours to first sale: ${metrics.marketplace.hoursToFirstSale}`);
  assert.equal(metrics.marketplace.spotsByState.settled, 2);

  assert.ok(metrics.users.total >= 8);
  assert.equal(metrics.health.disputesByState.withdrawn, 1);
  assert.equal(metrics.health.failedTxsLast7, 1);
  assert.equal(metrics.health.abandonedTxsLast7, 1);
  const withdrawalOps = metrics.health.txByOp.find((row) => row.op === "wallet_withdrawal")!;
  assert.deepEqual([withdrawalOps.failed, withdrawalOps.abandoned], [0, 1]);

  // Breakdowns: all four listings are seeded on one surface, half the settled value is fixed price.
  const surface = metrics.marketplace.bySurface.find((row) => row.sold >= 4)!;
  assert.equal(surface.settled, 200n * USDC, "payout + dispute split; the full refund is not a sale");
  assert.equal(metrics.marketplace.priceBuckets.find((row) => row.bucket === "$100 and up")?.count, 4);
  assert.equal(metrics.marketplace.auctionUplift, 1);
  assert.ok(metrics.marketplace.topCreators.length >= 1);
  assert.ok(metrics.marketplace.topListings.some((row) => row.bids === 2));
  assert.equal(metrics.money.escrowAmountByState.funded, 100n * USDC);
  assert.equal(metrics.money.feeRateBps, 312, "6.25 USDC of fees over 200 USDC paid to creators");
  assert.ok(metrics.users.funnel.signedUp >= metrics.users.funnel.bought);
  assert.equal(metrics.health.feePayerSol, 0.5);
  assert.equal(metrics.health.feePayerLow, true);

  assert.equal(metrics.daily.length, 30);
  const today = metrics.daily.at(-1)!;
  assert.equal(today.day, new Date().toISOString().slice(0, 10));
  assert.equal(today.settledGross, 300n * USDC);
  assert.equal(today.sales, 1);
  assert.ok(today.signups >= 8);
});

test("admin metrics flag an escrow mismatch and leave chain numbers empty without a chain", async () => {
  const mismatch = await adminMetrics(db, { feePayerLamports: 5_000_000_000, minFeePayerLamports: 1_000_000_000, treasuryUsdc: null, escrowOnChain: 1n });
  assert.equal(mismatch.money.escrow.matches, false);
  assert.equal(mismatch.health.feePayerLow, false);
  assert.equal(mismatch.money.treasury, null);

  const offline = await adminMetrics(db, null);
  assert.equal(offline.money.escrow.matches, null);
  assert.equal(offline.money.escrow.onChain, null);
  assert.equal(offline.health.feePayerSol, null);
});
