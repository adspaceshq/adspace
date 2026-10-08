import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { bids, chainTxs, disputes, settlements, spotEvents, spots } from "../src/db/schema.js";
import { activityFeed, creatorDashboard, reviewSummary, spotDetail, spotTimeline, sponsorDashboard } from "../src/services/dashboards.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
const TIMEOUT = 3 * 24 * 60 * 60;

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

test("creator: proof due, escrow, and on-time rate", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 24 * HOUR),
    funded: true,
  });
  const dashboard = await creatorDashboard(db, seller.user.id);
  assert.deepEqual(dashboard.needsYou.map((item) => [item.type, item.spotId]), [["proof_due", spot.id]]);
  assert.equal(dashboard.stats.pendingEscrow, 100n * USDC);
  assert.equal(dashboard.stats.spotsSold, 1);
  assert.equal(dashboard.stats.onTimeRate, null);
  assert.equal(dashboard.listings[0].soldCount, 1);
});

test("creator: payout ready and earnings after settlement", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - 200 * HOUR),
    deliveryDueAt: new Date(Date.now() - 100 * HOUR),
    funded: true,
  });
  await db.update(spots).set({ state: "delivered", proofSubmittedAt: new Date(Date.now() - 150 * HOUR) }).where(eq(spots.id, spot.id));
  let dashboard = await creatorDashboard(db, seller.user.id);
  assert.deepEqual(dashboard.needsYou.map((item) => item.type), ["payout_ready"]);
  assert.equal(dashboard.stats.onTimeRate, 1);

  const tx = await confirmedTx();
  await db.update(spots).set({ state: "settled" }).where(eq(spots.id, spot.id));
  await db.insert(settlements).values({ spotId: spot.id, kind: "payout", gross: 100n * USDC, fee: 5n * USDC, sellerNet: 95n * USDC, buyerRefund: 0n, chainTxId: tx.id });
  dashboard = await creatorDashboard(db, seller.user.id);
  assert.equal(dashboard.stats.earned, 95n * USDC);
  assert.deepEqual(dashboard.needsYou.map((item) => item.type), ["close_listing"]);
});

test("sponsor: proof review window, missed delivery, outbid, and dispute timeout", async () => {
  const sponsor = await seedUser(db, "sponsor");
  const delivered = await seedListing(db, { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  await db.update(spots).set({ buyerId: sponsor.user.id, state: "delivered", proofSubmittedAt: new Date() }).where(eq(spots.id, delivered.spot.id));
  const missed = await seedListing(db, { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  await db.update(spots).set({ buyerId: sponsor.user.id }).where(eq(spots.id, missed.spot.id));
  const auction = await seedListing(db, { mode: "auction", deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  await db.insert(bids).values({ spotId: auction.spot.id, bidderId: sponsor.user.id, bidderWallet: sponsor.user.walletAddress!, amount: 90n * USDC });
  const disputed = await seedListing(db, { deadline: new Date(Date.now() - 200 * HOUR), deliveryDueAt: new Date(Date.now() - 100 * HOUR), funded: true });
  await db.update(spots).set({ buyerId: sponsor.user.id, state: "disputed" }).where(eq(spots.id, disputed.spot.id));
  await db.insert(disputes).values({ spotId: disputed.spot.id, buyerId: sponsor.user.id, reason: "never delivered", openedAt: new Date(Date.now() - 80 * HOUR) });

  const dashboard = await sponsorDashboard(db, sponsor.user.id, TIMEOUT);
  const types = Object.fromEntries(dashboard.needsYou.map((item) => [item.spotId, item.type]));
  assert.equal(types[delivered.spot.id], "review_proof");
  assert.equal(types[missed.spot.id], "refund_available");
  assert.equal(types[auction.spot.id], "outbid");
  const outbid = dashboard.needsYou.find((item) => item.spotId === auction.spot.id)!;
  assert.equal(outbid.sellerHandle, auction.seller.user.handle);
  assert.equal(outbid.listingSlug, auction.listing.slug);
  assert.equal(types[disputed.spot.id], "dispute_timeout_ready");
  assert.equal(dashboard.stats.active, 3);
  assert.equal(dashboard.stats.inEscrow, 300n * USDC);
});

test("timeline is private and the activity feed is scoped to the user", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + HOUR), funded: true });
  const tx = await confirmedTx();
  await db.insert(spotEvents).values({ spotId: spot.id, fromState: "open", toState: "funded", type: "claimed", actorId: buyer!.user.id, chainTxId: tx.id });
  const stranger = await seedUser(db);
  await assert.rejects(spotTimeline(db, { id: stranger.user.id, isReviewer: false }, spot.id), /private/);
  const timeline = await spotTimeline(db, { id: buyer!.user.id, isReviewer: false }, spot.id);
  assert.equal(timeline.events[0].signature, tx.signature);
  const feed = await activityFeed(db, seller.user.id);
  assert.ok(feed.some((event) => event.spotId === spot.id && event.role === "creator"));
  assert.equal((await activityFeed(db, stranger.user.id)).length, 0);
});

test("review summary counts open disputes and failed transactions", async () => {
  const summary = await reviewSummary(db);
  assert.ok(summary.counts.openDisputes >= 1);
  assert.equal(summary.counts.openDisputes, summary.disputes.length);
  assert.equal(typeof summary.counts.listingsInReview, "number");
});

test("spot detail gives the sponsor brand, deadlines and dispute, and stays private", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  await db.update(spots).set({ brand: { name: "Acme", link: "https://acme.example" } }).where(eq(spots.id, spot.id));
  await db.insert(disputes).values({ spotId: spot.id, buyerId: buyer!.user.id, reason: "never delivered at all" });
  const asSponsor = await spotDetail(db, { id: buyer!.user.id, isReviewer: false }, spot.id, TIMEOUT);
  assert.equal(asSponsor.role, "sponsor");
  assert.equal(asSponsor.spot.buyerIsYou, true);
  assert.equal(asSponsor.spot.brand?.name, "Acme");
  assert.equal(asSponsor.dispute?.state, "open");
  assert.equal(asSponsor.dispute!.timeoutAt.getTime() - asSponsor.dispute!.openedAt.getTime(), TIMEOUT * 1000);
  assert.equal((await spotDetail(db, { id: seller.user.id, isReviewer: false }, spot.id, TIMEOUT)).role, "creator");
  const stranger = await seedUser(db);
  await assert.rejects(spotDetail(db, { id: stranger.user.id, isReviewer: false }, spot.id, TIMEOUT), /private/);
});
