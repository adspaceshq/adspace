import { and, asc, desc, eq, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import {
  bids,
  chainTxs,
  disputes,
  listingPhotos,
  listingPosts,
  listings,
  mediaAssets,
  settlements,
  spotEvents,
  spotProofPosts,
  spots,
  users,
} from "../db/schema.js";
import { payoutAvailableAt } from "./settlement.js";

export class DashboardError extends Error {
  constructor(message: string, readonly status = 403) {
    super(message);
  }
}

const ACTIVE_SPOT = ["funded", "delivered", "disputed"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export type NeedsYouItem = {
  type:
    | "proof_due"
    | "accept_terms"
    | "changes_requested"
    | "dispute_open"
    | "payout_ready"
    | "close_listing"
    | "review_proof"
    | "refund_available"
    | "outbid"
    | "dispute_timeout_ready";
  listingId: string;
  listingTitle: string;
  spotId?: string;
  spotIndex?: number;
  dueAt?: Date;
};

const sumUsdc = (rows: Array<{ total: string | null }>) => BigInt(rows[0]?.total ?? "0");
const byDueAt = (a: NeedsYouItem, b: NeedsYouItem) =>
  (a.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.dueAt?.getTime() ?? Number.MAX_SAFE_INTEGER);

export async function creatorDashboard(db: Db, sellerId: string, now = new Date()) {
  const owned = await db.select().from(listings).where(eq(listings.sellerId, sellerId)).orderBy(desc(listings.updatedAt));
  const listingIds = owned.map((listing) => listing.id);
  const ownedSpots = listingIds.length
    ? await db.select().from(spots).where(inArray(spots.listingId, listingIds)).orderBy(asc(spots.index))
    : [];
  const byId = new Map(owned.map((listing) => [listing.id, listing]));

  const [earned, escrow] = listingIds.length
    ? await Promise.all([
        db
          .select({ total: sql<string>`sum(${settlements.sellerNet})` })
          .from(settlements)
          .innerJoin(spots, eq(spots.id, settlements.spotId))
          .where(inArray(spots.listingId, listingIds)),
        db
          .select({ total: sql<string>`sum(${spots.amount})` })
          .from(spots)
          .where(and(inArray(spots.listingId, listingIds), inArray(spots.state, [...ACTIVE_SPOT]))),
      ])
    : [[], []];

  const sold = ownedSpots.filter((spot) => spot.buyerId !== null);
  const dueForDelivery = sold.filter((spot) => byId.get(spot.listingId)!.deliveryDueAt <= now);
  const onTime = dueForDelivery.filter(
    (spot) => spot.proofSubmittedAt && spot.proofSubmittedAt <= byId.get(spot.listingId)!.deliveryDueAt,
  );

  const needsYou: NeedsYouItem[] = [];
  for (const listing of owned) {
    const base = { listingId: listing.id, listingTitle: listing.title };
    if (listing.state === "approved") needsYou.push({ ...base, type: "accept_terms", dueAt: listing.deadline });
    if (listing.state === "changes_requested") needsYou.push({ ...base, type: "changes_requested" });
    const listingSpots = ownedSpots.filter((spot) => spot.listingId === listing.id);
    if (
      listing.state === "published" &&
      listing.deadline <= now &&
      listingSpots.every((spot) => ["settled", "refunded", "cancelled"].includes(spot.state))
    ) {
      needsYou.push({ ...base, type: "close_listing" });
    }
    for (const spot of listingSpots) {
      const item = { ...base, spotId: spot.id, spotIndex: spot.index };
      if (spot.state === "funded" && listing.deadline <= now && now < listing.deliveryDueAt) {
        needsYou.push({ ...item, type: "proof_due", dueAt: listing.deliveryDueAt });
      }
      if (spot.state === "disputed") needsYou.push({ ...item, type: "dispute_open" });
      if (spot.state === "delivered" && now >= payoutAvailableAt(listing)) needsYou.push({ ...item, type: "payout_ready" });
    }
  }

  return {
    stats: {
      earned: sumUsdc(earned),
      pendingEscrow: sumUsdc(escrow),
      liveListings: owned.filter((listing) => listing.state === "published").length,
      spotsSold: sold.length,
      onTimeRate: dueForDelivery.length ? onTime.length / dueForDelivery.length : null,
    },
    needsYou: needsYou.sort(byDueAt),
    listings: owned.map((listing) => {
      const listingSpots = ownedSpots.filter((spot) => spot.listingId === listing.id);
      return {
        ...listing,
        spotCount: listingSpots.length,
        soldCount: listingSpots.filter((spot) => spot.buyerId !== null).length,
        spots: listingSpots,
      };
    }),
  };
}

// Daily creator earnings for charting, oldest first.
export async function creatorEarnings(db: Db, sellerId: string, days = 90, now = new Date()) {
  const since = new Date(now.getTime() - days * DAY_MS);
  const rows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${settlements.settledAt}), 'YYYY-MM-DD')`,
      total: sql<string>`sum(${settlements.sellerNet})`,
    })
    .from(settlements)
    .innerJoin(spots, eq(spots.id, settlements.spotId))
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(eq(listings.sellerId, sellerId), gte(settlements.settledAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);
  return rows.map((row) => ({ day: row.day, earned: BigInt(row.total ?? "0") }));
}

export async function sponsorDashboard(db: Db, sponsorId: string, disputeTimeoutSeconds: number, now = new Date()) {
  const owned = await db
    .select({ spot: spots, listing: listings })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.buyerId, sponsorId))
    .orderBy(desc(spots.updatedAt));
  const ownedIds = owned.map((row) => row.spot.id);
  const [spent, openDisputes, outbidRows] = await Promise.all([
    ownedIds.length
      ? db
          .select({ total: sql<string>`sum(${settlements.sellerNet} + ${settlements.fee})` })
          .from(settlements)
          .where(inArray(settlements.spotId, ownedIds))
      : Promise.resolve([]),
    ownedIds.length
      ? db.select().from(disputes).where(and(inArray(disputes.spotId, ownedIds), eq(disputes.state, "open")))
      : Promise.resolve([]),
    db
      .selectDistinct({ spot: spots, listing: listings })
      .from(bids)
      .innerJoin(spots, eq(spots.id, bids.spotId))
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .where(and(eq(bids.bidderId, sponsorId), eq(spots.state, "funded"), gte(listings.deadline, now))),
  ]);

  const needsYou: NeedsYouItem[] = [];
  for (const { spot, listing } of owned) {
    const item = { listingId: listing.id, listingTitle: listing.title, spotId: spot.id, spotIndex: spot.index };
    if (spot.state === "delivered" && now < payoutAvailableAt(listing)) {
      needsYou.push({ ...item, type: "review_proof", dueAt: payoutAvailableAt(listing) });
    }
    if (spot.state === "funded" && now >= listing.deliveryDueAt) needsYou.push({ ...item, type: "refund_available" });
    const dispute = openDisputes.find((row) => row.spotId === spot.id);
    if (dispute && now.getTime() >= dispute.openedAt.getTime() + disputeTimeoutSeconds * 1000) {
      needsYou.push({ ...item, type: "dispute_timeout_ready" });
    }
  }
  for (const { spot, listing } of outbidRows) {
    if (spot.buyerId === sponsorId) continue;
    needsYou.push({ type: "outbid", listingId: listing.id, listingTitle: listing.title, spotId: spot.id, spotIndex: spot.index, dueAt: listing.deadline });
  }

  const active = owned.filter((row) => (ACTIVE_SPOT as readonly string[]).includes(row.spot.state));
  return {
    stats: {
      spent: sumUsdc(spent),
      inEscrow: active.reduce((total, row) => total + (row.spot.amount ?? 0n), 0n),
      active: active.length,
      delivered: owned.filter((row) => row.spot.state === "settled").length,
    },
    needsYou: needsYou.sort(byDueAt),
    spots: owned.map(({ spot, listing }) => ({
      ...spot,
      listing: { id: listing.id, slug: listing.slug, title: listing.title, mode: listing.mode, deadline: listing.deadline, deliveryDueAt: listing.deliveryDueAt },
      reviewUntil: spot.state === "delivered" ? payoutAvailableAt(listing) : null,
    })),
  };
}

// Everything a sponsor, the creator or a reviewer needs on one spot page. Private to them.
export async function spotDetail(
  db: Db,
  actor: { id: string; isReviewer: boolean },
  spotId: string,
  disputeTimeoutSeconds: number,
) {
  const [row] = await db
    .select({
      spot: spots,
      listing: listings,
      seller: { id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl, verified: users.verified },
    })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(spots.id, spotId));
  if (!row) throw new DashboardError("spot not found", 404);
  const { spot, listing, seller } = row;
  const role = actor.id === spot.buyerId ? "sponsor" : actor.id === listing.sellerId ? "creator" : actor.isReviewer ? "reviewer" : null;
  if (!role) throw new DashboardError("this spot is private");

  const [photos, proofPosts, [dispute], [settlement]] = await Promise.all([
    db
      .select({ url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
      .from(listingPhotos)
      .innerJoin(mediaAssets, eq(mediaAssets.id, listingPhotos.assetId))
      .where(eq(listingPhotos.listingId, listing.id))
      .orderBy(asc(listingPhotos.position)),
    db
      .select({ id: listingPosts.id, kind: listingPosts.kind, url: listingPosts.url, body: listingPosts.body, createdAt: listingPosts.createdAt })
      .from(spotProofPosts)
      .innerJoin(listingPosts, eq(listingPosts.id, spotProofPosts.postId))
      .where(eq(spotProofPosts.spotId, spot.id))
      .orderBy(asc(listingPosts.createdAt)),
    db.select().from(disputes).where(eq(disputes.spotId, spot.id)).orderBy(desc(disputes.openedAt)).limit(1),
    db.select().from(settlements).where(eq(settlements.spotId, spot.id)),
  ]);

  const reviewUntil = payoutAvailableAt(listing);
  return {
    role,
    spot: {
      id: spot.id,
      index: spot.index,
      label: spot.label,
      price: spot.price,
      layout: spot.layout,
      state: spot.state,
      amount: spot.amount,
      brand: spot.brand,
      proofSubmittedAt: spot.proofSubmittedAt,
      chainAddress: spot.chainAddress,
      buyerIsYou: spot.buyerId === actor.id,
    },
    listing: {
      id: listing.id,
      slug: listing.slug,
      title: listing.title,
      mode: listing.mode,
      surface: listing.surface,
      deadline: listing.deadline,
      deliveryDueAt: listing.deliveryDueAt,
      reviewWindowSeconds: listing.reviewWindowSeconds,
      chainAddress: listing.chainAddress,
      photos,
    },
    seller,
    proofPosts,
    dispute: dispute
      ? {
          id: dispute.id,
          state: dispute.state,
          reason: dispute.reason,
          openedAt: dispute.openedAt,
          closedAt: dispute.closedAt,
          sellerShareBps: dispute.sellerShareBps,
          decision: dispute.decision,
          timeoutAt: new Date(dispute.openedAt.getTime() + disputeTimeoutSeconds * 1000),
        }
      : null,
    settlement: settlement ?? null,
    deadlines: {
      deliveryDueAt: listing.deliveryDueAt,
      reviewUntil,
    },
  };
}

// Visible to the spot's sponsor, its creator, and reviewers.
export async function spotTimeline(db: Db, actor: { id: string; isReviewer: boolean }, spotId: string) {
  const [row] = await db
    .select({ buyerId: spots.buyerId, sellerId: listings.sellerId })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.id, spotId));
  if (!row) throw new DashboardError("spot not found", 404);
  if (actor.id !== row.buyerId && actor.id !== row.sellerId && !actor.isReviewer) throw new DashboardError("this spot is private");
  const [events, settlement] = await Promise.all([
    db
      .select({
        id: spotEvents.id,
        type: spotEvents.type,
        fromState: spotEvents.fromState,
        toState: spotEvents.toState,
        data: spotEvents.data,
        createdAt: spotEvents.createdAt,
        signature: chainTxs.signature,
      })
      .from(spotEvents)
      .leftJoin(chainTxs, eq(chainTxs.id, spotEvents.chainTxId))
      .where(eq(spotEvents.spotId, spotId))
      .orderBy(asc(spotEvents.createdAt)),
    db.select().from(settlements).where(eq(settlements.spotId, spotId)),
  ]);
  return { events, settlement: settlement[0] ?? null };
}

// Recent events on spots the user sells or sponsors, newest first.
export async function activityFeed(db: Db, userId: string, limit = 30) {
  return db
    .select({
      id: spotEvents.id,
      type: spotEvents.type,
      toState: spotEvents.toState,
      createdAt: spotEvents.createdAt,
      spotId: spots.id,
      spotIndex: spots.index,
      listingId: listings.id,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      signature: chainTxs.signature,
      role: sql<"creator" | "sponsor">`case when ${listings.sellerId} = ${userId} then 'creator' else 'sponsor' end`,
    })
    .from(spotEvents)
    .innerJoin(spots, eq(spots.id, spotEvents.spotId))
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .leftJoin(chainTxs, eq(chainTxs.id, spotEvents.chainTxId))
    .where(or(eq(listings.sellerId, userId), eq(spots.buyerId, userId)))
    .orderBy(desc(spotEvents.createdAt))
    .limit(limit);
}

// Counts and work lists for the reviewer queue tabs.
export async function reviewSummary(db: Db, now = new Date()) {
  const buyer = alias(users, "buyer");
  const [inReview, openDisputes, delivered, failedTxs] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(listings).where(eq(listings.state, "in_review")),
    db
      .select({
        dispute: disputes,
        spotId: spots.id,
        spotIndex: spots.index,
        amount: spots.amount,
        listingId: listings.id,
        listingTitle: listings.title,
        sellerHandle: users.handle,
        buyerHandle: buyer.handle,
      })
      .from(disputes)
      .innerJoin(spots, eq(spots.id, disputes.spotId))
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .innerJoin(users, eq(users.id, listings.sellerId))
      .innerJoin(buyer, eq(buyer.id, disputes.buyerId))
      .where(eq(disputes.state, "open"))
      .orderBy(asc(disputes.openedAt)),
    db
      .select({ spotId: spots.id, spotIndex: spots.index, amount: spots.amount, listing: listings })
      .from(spots)
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .where(eq(spots.state, "delivered")),
    db
      .select({ id: chainTxs.id, op: chainTxs.op, error: chainTxs.error, signature: chainTxs.signature, updatedAt: chainTxs.updatedAt, spotId: chainTxs.spotId })
      .from(chainTxs)
      .where(and(eq(chainTxs.status, "failed"), isNotNull(chainTxs.updatedAt), gte(chainTxs.updatedAt, new Date(now.getTime() - 7 * DAY_MS))))
      .orderBy(desc(chainTxs.updatedAt))
      .limit(100),
  ]);
  const payoutsReady = delivered
    .filter((row) => now >= payoutAvailableAt(row.listing))
    .map((row) => ({ spotId: row.spotId, spotIndex: row.spotIndex, amount: row.amount, listingId: row.listing.id, listingTitle: row.listing.title }));
  return {
    counts: {
      listingsInReview: inReview[0]?.count ?? 0,
      openDisputes: openDisputes.length,
      payoutsReady: payoutsReady.length,
      failedTxs: failedTxs.length,
    },
    disputes: openDisputes,
    payoutsReady,
    failedTxs,
  };
}
