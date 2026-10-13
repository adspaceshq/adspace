import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { bids, chainTxs, disputes, listingPhotos, mediaAssets, settlements, spotEvents, spots } from "../src/db/schema.js";
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

test("sponsor: cards carry listing photos and each spot's settlement; spent is net of refunds", async () => {
  const sponsor = await seedUser(db, "sponsor");
  const past = { deadline: new Date(Date.now() - 200 * HOUR), deliveryDueAt: new Date(Date.now() - 100 * HOUR), funded: true };
  const split = await seedListing(db, past);
  const refunded = await seedListing(db, past);
  const paid = await seedListing(db, past);
  const active = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 24 * HOUR), funded: true });
  await db.update(spots).set({ buyerId: sponsor.user.id, state: "settled", layout: { x: 50, y: 50, w: 20, view: "1" } }).where(eq(spots.id, split.spot.id));
  await db.update(spots).set({ buyerId: sponsor.user.id, state: "refunded" }).where(eq(spots.id, refunded.spot.id));
  await db.update(spots).set({ buyerId: sponsor.user.id, state: "settled" }).where(eq(spots.id, paid.spot.id));
  await db.update(spots).set({ buyerId: sponsor.user.id }).where(eq(spots.id, active.spot.id));

  // Photos inserted out of order: the dashboard returns them by position.
  const [second, cover] = await db
    .insert(mediaAssets)
    .values([
      { ownerId: split.seller.user.id, kind: "listing_photo", url: "https://res.cloudinary.com/x/image/upload/second.jpg", bytes: 1, width: 800, height: 600 },
      { ownerId: split.seller.user.id, kind: "listing_photo", url: "https://res.cloudinary.com/x/image/upload/cover.jpg", bytes: 1, width: 800, height: 600 },
    ])
    .returning();
  await db.insert(listingPhotos).values([
    { listingId: split.listing.id, assetId: second.id, position: 1 },
    { listingId: split.listing.id, assetId: cover.id, position: 0 },
  ]);

  await db.insert(settlements).values([
    { spotId: split.spot.id, kind: "dispute_split", gross: 100n * USDC, fee: 2n * USDC, sellerNet: 48n * USDC, buyerRefund: 50n * USDC, chainTxId: (await confirmedTx()).id },
    { spotId: refunded.spot.id, kind: "timeout_refund", gross: 100n * USDC, fee: 0n, sellerNet: 0n, buyerRefund: 100n * USDC, chainTxId: (await confirmedTx()).id },
    { spotId: paid.spot.id, kind: "payout", gross: 100n * USDC, fee: 5n * USDC, sellerNet: 95n * USDC, buyerRefund: 0n, chainTxId: (await confirmedTx()).id },
  ]);

  const dashboard = await sponsorDashboard(db, sponsor.user.id, TIMEOUT);
  const card = (id: string) => dashboard.spots.find((spot) => spot.id === id)!;
  assert.deepEqual(
    card(split.spot.id).listing.photos.map((photo) => photo.url),
    ["https://res.cloudinary.com/x/image/upload/cover.jpg", "https://res.cloudinary.com/x/image/upload/second.jpg"],
  );
  assert.equal(card(split.spot.id).layout.view, "1");
  assert.deepEqual(card(paid.spot.id).listing.photos, []);
  assert.deepEqual(
    { kind: card(split.spot.id).settlement?.kind, refund: card(split.spot.id).settlement?.buyerRefund, net: card(split.spot.id).settlement?.sellerNet, fee: card(split.spot.id).settlement?.fee },
    { kind: "dispute_split", refund: 50n * USDC, net: 48n * USDC, fee: 2n * USDC },
  );
  assert.equal(card(refunded.spot.id).settlement?.kind, "timeout_refund");
  assert.equal(card(paid.spot.id).settlement?.kind, "payout");
  assert.equal(card(active.spot.id).settlement, null);
  // 50 kept by the split (48 + 2 fee) + 0 from the refund + 100 from the payout.
  assert.equal(dashboard.stats.spent, 150n * USDC);
  assert.equal(dashboard.stats.inEscrow, 100n * USDC);
  assert.equal(dashboard.stats.delivered, 2);
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

test("activity feed pages by cursor and filters by role", async () => {
  const { seller, spot } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + HOUR), funded: true });
  const base = Date.now() - 10 * HOUR;
  for (let i = 0; i < 3; i += 1) {
    await db.insert(spotEvents).values({ spotId: spot.id, type: `event_${i}`, createdAt: new Date(base + i * HOUR) });
  }
  const first = await activityFeed(db, seller.user.id, { limit: 2 });
  assert.deepEqual(first.map((event) => event.type), ["event_2", "event_1"]);
  const next = await activityFeed(db, seller.user.id, { limit: 2, before: new Date(first[1].createdAt) });
  assert.deepEqual(next.map((event) => event.type), ["event_0"]);
  assert.equal((await activityFeed(db, seller.user.id, { role: "sponsor" })).length, 0);
  assert.equal((await activityFeed(db, seller.user.id, { role: "creator" })).length, 3);
});
