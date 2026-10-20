import { and, asc, desc, eq, gte, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import {
  bids,
  chainTxs,
  disputeEvidence,
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
import { LIVE_PROPOSAL, staleSquadsProposals } from "./disputes.js";

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
    | "review_proof"
    | "refund_available"
    | "outbid"
    | "dispute_timeout_ready";
  listingId: string;
  listingTitle: string;
  // For linking to the public listing page (/@handle/slug).
  listingSlug: string;
  sellerHandle: string;
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
  const [ownedSpots, photos] = listingIds.length
    ? await Promise.all([
        db.select().from(spots).where(inArray(spots.listingId, listingIds)).orderBy(asc(spots.index)),
        db
          .select({ listingId: listingPhotos.listingId, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
          .from(listingPhotos)
          .innerJoin(mediaAssets, eq(mediaAssets.id, listingPhotos.assetId))
          .where(inArray(listingPhotos.listingId, listingIds))
          .orderBy(asc(listingPhotos.position)),
      ])
    : [[], []];
  const byId = new Map(owned.map((listing) => [listing.id, listing]));
  const [owner] = await db.select({ handle: users.handle }).from(users).where(eq(users.id, sellerId));

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
    const base = { listingId: listing.id, listingTitle: listing.title, listingSlug: listing.slug, sellerHandle: owner?.handle ?? "" };
    if (listing.state === "approved") needsYou.push({ ...base, type: "accept_terms", dueAt: listing.deadline });
    if (listing.state === "changes_requested") needsYou.push({ ...base, type: "changes_requested" });
    // A finished listing needs nothing from the creator: closing it is admin-only (the rent panel).
    const listingSpots = ownedSpots.filter((spot) => spot.listingId === listing.id);
    for (const spot of listingSpots) {
      const item = { ...base, spotId: spot.id, spotIndex: spot.index };
      // Proof is accepted on-chain only from artwork close.
      if (spot.state === "funded" && listing.artworkDueAt <= now && now < listing.deliveryDueAt) {
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
        photos: photos.filter((photo) => photo.listingId === listing.id).map(({ listingId: _listingId, ...photo }) => photo),
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
    .select({ spot: spots, listing: listings, sellerHandle: users.handle })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(spots.buyerId, sponsorId))
    .orderBy(desc(spots.updatedAt));
  const ownedIds = owned.map((row) => row.spot.id);
  const listingIds = [...new Set(owned.map((row) => row.listing.id))];
  const [openDisputes, outbidRows, photos, spotSettlements] = await Promise.all([
    ownedIds.length
      ? db.select().from(disputes).where(and(inArray(disputes.spotId, ownedIds), eq(disputes.state, "open")))
      : Promise.resolve([]),
    db
      .selectDistinct({ spot: spots, listing: listings, sellerHandle: users.handle })
      .from(bids)
      .innerJoin(spots, eq(spots.id, bids.spotId))
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .innerJoin(users, eq(users.id, listings.sellerId))
      .where(and(eq(bids.bidderId, sponsorId), eq(spots.state, "funded"), gte(listings.deadline, now))),
    // Each card draws the photo its spot sits on, so the listing's photos come along in order.
    listingIds.length
      ? db
          .select({ listingId: listingPhotos.listingId, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
          .from(listingPhotos)
          .innerJoin(mediaAssets, eq(mediaAssets.id, listingPhotos.assetId))
          .where(inArray(listingPhotos.listingId, listingIds))
          .orderBy(asc(listingPhotos.position))
      : Promise.resolve([]),
    ownedIds.length
      ? db
          .select({
            spotId: settlements.spotId,
            kind: settlements.kind,
            gross: settlements.gross,
            fee: settlements.fee,
            sellerNet: settlements.sellerNet,
            buyerRefund: settlements.buyerRefund,
            settledAt: settlements.settledAt,
          })
          .from(settlements)
          .where(inArray(settlements.spotId, ownedIds))
      : Promise.resolve([]),
  ]);
  const settlementBySpot = new Map(spotSettlements.map(({ spotId, ...settlement }) => [spotId, settlement]));

  const needsYou: NeedsYouItem[] = [];
  for (const { spot, listing, sellerHandle } of owned) {
    const item = { listingId: listing.id, listingTitle: listing.title, listingSlug: listing.slug, sellerHandle, spotId: spot.id, spotIndex: spot.index };
    if (spot.state === "delivered" && now < payoutAvailableAt(listing)) {
      needsYou.push({ ...item, type: "review_proof", dueAt: payoutAvailableAt(listing) });
    }
    if (spot.state === "funded" && now >= listing.deliveryDueAt) needsYou.push({ ...item, type: "refund_available" });
    const dispute = openDisputes.find((row) => row.spotId === spot.id);
    if (dispute && now.getTime() >= dispute.openedAt.getTime() + disputeTimeoutSeconds * 1000) {
      needsYou.push({ ...item, type: "dispute_timeout_ready" });
    }
  }
  for (const { spot, listing, sellerHandle } of outbidRows) {
    if (spot.buyerId === sponsorId) continue;
    needsYou.push({
      type: "outbid",
      listingId: listing.id,
      listingTitle: listing.title,
      listingSlug: listing.slug,
      sellerHandle,
      spotId: spot.id,
      spotIndex: spot.index,
      dueAt: listing.deadline,
    });
  }

  const active = owned.filter((row) => (ACTIVE_SPOT as readonly string[]).includes(row.spot.state));
  return {
    stats: {
      // What actually left the sponsor's wallet: the creator's share plus the fee, never the refunded part.
      spent: spotSettlements.reduce((total, row) => total + row.sellerNet + row.fee, 0n),
      inEscrow: active.reduce((total, row) => total + (row.spot.amount ?? 0n), 0n),
      active: active.length,
      delivered: owned.filter((row) => row.spot.state === "settled").length,
    },
    needsYou: needsYou.sort(byDueAt),
    spots: owned.map(({ spot, listing, sellerHandle }) => ({
      ...spot,
      listing: {
        id: listing.id,
        slug: listing.slug,
        title: listing.title,
        mode: listing.mode,
        deadline: listing.deadline,
        deliveryDueAt: listing.deliveryDueAt,
        sellerHandle,
        photos: photos.filter((photo) => photo.listingId === listing.id).map(({ listingId: _listingId, ...photo }) => photo),
      },
      reviewUntil: spot.state === "delivered" ? payoutAvailableAt(listing) : null,
      // Where the money went once the spot finished; null while it is still in escrow.
      settlement: settlementBySpot.get(spot.id) ?? null,
    })),
  };
}

// Everything a sponsor, the creator or a reviewer needs on one spot page. Private to them.
export async function spotDetail(
  db: Db,
  actor: { id: string; isReviewer: boolean },
  spotId: string,
  disputeTimeoutSeconds: number,
  readDisputeDeadlines?: DisputeDeadlineSource["readDeadlines"],
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
  // Images the sponsor attached when raising the dispute, in the order they chose.
  const evidence = dispute
    ? await db
        .select({ id: mediaAssets.id, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
        .from(disputeEvidence)
        .innerJoin(mediaAssets, eq(mediaAssets.id, disputeEvidence.assetId))
        .where(eq(disputeEvidence.disputeId, dispute.id))
        .orderBy(asc(disputeEvidence.position))
    : [];
  const [timeoutAt] = dispute
    ? await disputeDeadlines(
        // Only an open dispute still has its on-chain record.
        [{ openedAt: dispute.openedAt, spotAddress: dispute.state === "open" ? spot.chainAddress : null }],
        { readDeadlines: readDisputeDeadlines, timeoutSeconds: disputeTimeoutSeconds },
      )
    : [];
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
      // The token account holding this spot's USDC, so people can check the escrow themselves.
      vaultAddress: spot.vaultAddress,
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
      // The fee policy snapshotted on-chain at publish; null before approval.
      feeBps: listing.feeBps,
      upliftFeeBps: listing.upliftFeeBps,
      maxFeeBps: listing.maxFeeBps,
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
          timeoutAt,
          evidence,
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
export interface ActivityOptions {
  limit?: number;
  // Cursor: only events older than this.
  before?: Date;
  role?: "creator" | "sponsor";
}

export async function activityFeed(db: Db, userId: string, options: ActivityOptions | number = {}) {
  const { limit = 30, before, role } = typeof options === "number" ? { limit: options } : options;
  const mine =
    role === "creator" ? eq(listings.sellerId, userId) : role === "sponsor" ? eq(spots.buyerId, userId) : or(eq(listings.sellerId, userId), eq(spots.buyerId, userId));
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
    .where(and(mine, before ? lt(spotEvents.createdAt, before) : undefined))
    .orderBy(desc(spotEvents.createdAt), desc(spotEvents.id))
    .limit(limit);
}

export interface DisputeDeadlineSource {
  // On-chain deadlines per spot address (opened_at + the timeout captured when the dispute was raised).
  readDeadlines?: (spotAddresses: string[]) => Promise<Array<Date | null>>;
  // Current config timeout; the fallback when the chain can't be read.
  timeoutSeconds: number;
}

// When each open dispute refunds the sponsor in full if nobody resolves it. Prefers the chain, which
// holds the timeout captured at raise; falls back to the DB open time plus the current config timeout.
async function disputeDeadlines(
  rows: Array<{ openedAt: Date; spotAddress: string | null }>,
  source: DisputeDeadlineSource,
): Promise<Date[]> {
  const addresses = rows.map((row) => row.spotAddress).filter((address): address is string => Boolean(address));
  const onChain = new Map<string, Date | null>();
  if (source.readDeadlines && addresses.length) {
    try {
      const deadlines = await source.readDeadlines(addresses);
      addresses.forEach((address, index) => onChain.set(address, deadlines[index] ?? null));
    } catch (error) {
      console.error("reading dispute deadlines failed:", error instanceof Error ? error.message : error);
    }
  }
  return rows.map(
    (row) => (row.spotAddress ? onChain.get(row.spotAddress) : null) ?? new Date(row.openedAt.getTime() + source.timeoutSeconds * 1000),
  );
}

// Counts and work lists for the reviewer queue tabs. `proposalStatus` reads Squads so resolve proposals
// whose dispute closed another way are listed until someone cancels them.
export async function reviewSummary(
  db: Db,
  now = new Date(),
  deadlines: DisputeDeadlineSource = { timeoutSeconds: 3 * DAY_MS / 1000 },
  options: { proposalStatus?: (transactionIndex: bigint) => Promise<string | null> } = {},
) {
  const buyer = alias(users, "buyer");
  const [inReview, openDisputes, delivered, failedTxs] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(listings).where(eq(listings.state, "in_review")),
    db
      .select({
        dispute: disputes,
        spotId: spots.id,
        spotIndex: spots.index,
        spotAddress: spots.chainAddress,
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
  // Soonest timeout first: a 2-of-3 multisig approval takes time, and a timed-out dispute refunds in full.
  const timeouts = await disputeDeadlines(
    openDisputes.map((row) => ({ openedAt: row.dispute.openedAt, spotAddress: row.spotAddress })),
    deadlines,
  );
  // Same rule as resolveDispute: a proposal still live in Squads blocks a new one; a rejected, cancelled
  // or missing one frees the dispute. A failed status read counts as live, so nobody double-proposes.
  const proposals = await Promise.all(
    openDisputes.map(async (row) => {
      const index = row.dispute.squadsTransactionIndex;
      if (index === null) return { live: false, status: null };
      if (!options.proposalStatus) return { live: true, status: null };
      const status = await options.proposalStatus(BigInt(index)).then(
        (value) => value,
        () => "unreadable",
      );
      return { live: status === "unreadable" || (status !== null && LIVE_PROPOSAL.has(status)), status: status === "unreadable" ? null : status };
    }),
  );
  const disputesByDeadline = openDisputes
    .map(({ spotAddress: _spotAddress, ...row }, index) => ({ ...row, timeoutAt: timeouts[index], proposalLive: proposals[index].live, proposalStatus: proposals[index].status }))
    .sort((a, b) => a.timeoutAt.getTime() - b.timeoutAt.getTime());
  const staleProposals = await staleSquadsProposals(db, { proposalStatus: options.proposalStatus, now });
  return {
    counts: {
      listingsInReview: inReview[0]?.count ?? 0,
      openDisputes: openDisputes.length,
      payoutsReady: payoutsReady.length,
      failedTxs: failedTxs.length,
      staleProposals: staleProposals.length,
    },
    disputes: disputesByDeadline,
    staleProposals,
    payoutsReady,
    failedTxs,
  };
}
