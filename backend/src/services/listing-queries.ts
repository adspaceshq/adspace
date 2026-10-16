import { and, asc, desc, eq, gt, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { disputes, listingPhotos, listings, mediaAssets, settlements, spots, users } from "../db/schema.js";
import { ADMIN_APPROVAL_AFTER_DAYS, needsAdminApproval } from "./listing-lifecycle.js";

type ListingRow = typeof listings.$inferSelect;
type SpotRow = typeof spots.$inferSelect;
type Surface = ListingRow["surface"];

const sellerColumns = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  hasX: users.xUserId,
  verified: users.verified,
};

type SellerRow = { id: string; handle: string; displayName: string; avatarUrl: string | null; hasX: string | null; verified: boolean };
const publicSeller = (seller: SellerRow) => ({ ...seller, hasX: Boolean(seller.hasX) });

async function hydrate(db: Db, rows: ListingRow[]) {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [allSpots, photos] = await Promise.all([
    db.select().from(spots).where(inArray(spots.listingId, ids)).orderBy(asc(spots.index)),
    db
      .select({ listingId: listingPhotos.listingId, id: mediaAssets.id, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
      .from(listingPhotos)
      .innerJoin(mediaAssets, eq(mediaAssets.id, listingPhotos.assetId))
      .where(inArray(listingPhotos.listingId, ids))
      .orderBy(asc(listingPhotos.position)),
  ]);
  return rows.map((row) => ({
    ...row,
    spots: allSpots.filter((spot) => spot.listingId === row.id),
    photos: photos.filter((photo) => photo.listingId === row.id).map(({ listingId: _listingId, ...photo }) => photo),
  }));
}

type SponsorProfile = { handle: string; displayName: string; avatarUrl: string | null };
const SOLD = ["funded", "delivered", "disputed", "settled"];

// Wallets stay private. Once a spot is sold (or has a leading bid) its brand is public, and so is the
// sponsor's adspaces profile when `sponsors` is given, so anyone can click through to them.
export function publicSpot(spot: SpotRow, sponsors?: Map<string, SponsorProfile>) {
  const sold = SOLD.includes(spot.state);
  const sponsor = sold && spot.buyerId ? sponsors?.get(spot.buyerId) : undefined;
  return {
    brand: sold && spot.brand ? { name: spot.brand.name, logoUrl: spot.brand.logoUrl, link: spot.brand.link, handle: spot.brand.handle } : null,
    sponsor: sponsor ?? null,
    id: spot.id,
    index: spot.index,
    label: spot.label,
    price: spot.price,
    layout: spot.layout,
    state: spot.state,
    amount: spot.amount,
    taken: spot.state !== "open" && spot.state !== "cancelled" && spot.state !== "refunded",
  };
}

export async function getPublishedListing(db: Db, slug: string) {
  const [row] = await db
    .select({ listing: listings, seller: sellerColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(and(eq(listings.slug, slug), inArray(listings.state, ["published", "closed"])));
  if (!row) return undefined;
  const [listing] = await hydrate(db, [row.listing]);
  const buyerIds = [...new Set(listing.spots.filter((spot) => SOLD.includes(spot.state) && spot.buyerId).map((spot) => spot.buyerId!))];
  const sponsors = new Map<string, SponsorProfile>(
    buyerIds.length
      ? (
          await db
            .select({ id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(inArray(users.id, buyerIds))
        ).map(({ id, ...profile }) => [id, profile])
      : [],
  );
  return { ...listing, spots: listing.spots.map((spot) => publicSpot(spot, sponsors)), seller: publicSeller(row.seller) };
}

export interface BrowseFilters {
  q?: string;
  surface?: Surface;
  mode?: "fixed" | "auction";
  sort?: "closing" | "newest" | "price";
  includeClosed?: boolean;
  limit?: number;
  offset?: number;
}

const SURFACES: readonly Surface[] = ["laptop", "tshirt", "car", "suitcase", "bike", "digital", "other"];

export function parseBrowseFilters(query: Record<string, unknown>): BrowseFilters {
  const text = (key: string) => (typeof query[key] === "string" ? (query[key] as string).trim() : "");
  const surface = text("surface") as Surface;
  const mode = text("mode");
  const sort = text("sort");
  return {
    q: text("q").slice(0, 80) || undefined,
    surface: SURFACES.includes(surface) ? surface : undefined,
    mode: mode === "fixed" || mode === "auction" ? mode : undefined,
    sort: sort === "newest" || sort === "price" ? sort : "closing",
    includeClosed: text("includeClosed") === "true",
    limit: Math.min(Math.max(Number(text("limit")) || 24, 1), 48),
    offset: Math.max(Number(text("offset")) || 0, 0),
  };
}

// Public discovery feed; `hasMore` drives "load more".
export async function listPublished(db: Db, filters: BrowseFilters = {}, now = new Date()) {
  const limit = filters.limit ?? 24;
  const conditions: SQL[] = [eq(listings.state, "published")];
  if (!filters.includeClosed) conditions.push(gt(listings.deadline, now));
  if (filters.surface) conditions.push(eq(listings.surface, filters.surface));
  if (filters.mode) conditions.push(eq(listings.mode, filters.mode));
  if (filters.q) {
    const pattern = `%${filters.q.replace(/[%_\\]/g, (char) => `\\${char}`)}%`;
    conditions.push(
      or(
        ilike(listings.title, pattern),
        ilike(listings.description, pattern),
        ilike(users.handle, pattern),
        sql`${listings.audience}->>'event' ILIKE ${pattern}`,
        sql`${listings.audience}->>'location' ILIKE ${pattern}`,
      )!,
    );
  }
  const minPrice = sql`(SELECT min(${spots.price}) FROM ${spots} WHERE ${spots.listingId} = ${listings.id})`;
  const order =
    filters.sort === "newest"
      ? [desc(listings.publishedAt)]
      : filters.sort === "price"
        ? [asc(minPrice), asc(listings.deadline)]
        : [asc(listings.deadline)];
  const rows = await db
    .select({ listing: listings, seller: sellerColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(and(...conditions))
    .orderBy(...order, asc(listings.id))
    .limit(limit + 1)
    .offset(filters.offset ?? 0);
  const page = rows.slice(0, limit);
  const hydrated = await hydrate(db, page.map((row) => row.listing));
  return {
    items: hydrated.map((listing, index) => ({
      ...listing,
      spots: listing.spots.map((spot) => publicSpot(spot)),
      seller: publicSeller(page[index].seller),
    })),
    hasMore: rows.length > limit,
  };
}

export async function getOwnedListing(db: Db, sellerId: string, listingId: string) {
  const [row] = await db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, sellerId)));
  if (!row) return undefined;
  const [listing] = await hydrate(db, [row]);
  return listing;
}

export async function listForSeller(db: Db, sellerId: string) {
  const rows = await db.select().from(listings).where(eq(listings.sellerId, sellerId)).orderBy(desc(listings.updatedAt));
  return hydrate(db, rows);
}

export async function reviewQueue(db: Db) {
  const rows = await db
    .select({ listing: listings, seller: sellerColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.state, "in_review"))
    .orderBy(asc(listings.updatedAt));
  const hydrated = await hydrate(db, rows.map((row) => row.listing));
  return hydrated.map((listing, index) => ({ ...listing, seller: publicSeller(rows[index].seller), ...approvalRule(listing.deliveryDueAt) }));
}

// Delivery more than ADMIN_APPROVAL_AFTER_DAYS out can only be approved by an admin.
const approvalRule = (deliveryDueAt: Date, now = new Date()) => ({
  needsAdminApproval: needsAdminApproval(deliveryDueAt, now),
  adminApprovalAfterDays: ADMIN_APPROVAL_AFTER_DAYS,
});

// A creator's track record for reviewers, excluding the listing under review: how many listings they
// submitted and got live, and what happened to the spots sponsors paid for.
export async function sellerHistory(db: Db, sellerId: string, excludeListingId: string, now = new Date()) {
  const others = and(eq(listings.sellerId, sellerId), ne(listings.id, excludeListingId));
  const [[listingCounts], [spotCounts], [disputeCounts]] = await Promise.all([
    db
      .select({
        submitted: sql<number>`count(*) filter (where ${listings.state} <> 'draft')`,
        live: sql<number>`count(*) filter (where ${inArray(listings.state, ["published", "closed"])})`,
        rejected: sql<number>`count(*) filter (where ${listings.state} = 'rejected')`,
      })
      .from(listings)
      .where(others),
    db
      .select({
        sold: sql<number>`count(*) filter (where ${spots.buyerId} is not null and ${spots.state} <> 'open')`,
        paidOut: sql<number>`count(*) filter (where ${settlements.kind} = 'payout')`,
        refunded: sql<number>`count(*) filter (where ${inArray(settlements.kind, ["refund", "timeout_refund"])})`,
        delivered: sql<number>`count(*) filter (where ${spots.proofSubmittedAt} is not null)`,
        onTime: sql<number>`count(*) filter (where ${spots.proofSubmittedAt} <= ${listings.deliveryDueAt})`,
        overdue: sql<number>`count(*) filter (where ${spots.state} = 'funded' and ${spots.proofSubmittedAt} is null and ${listings.deliveryDueAt} < ${now})`,
      })
      .from(spots)
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .leftJoin(settlements, eq(settlements.spotId, spots.id))
      .where(others),
    db
      .select({ total: sql<number>`count(*)`, open: sql<number>`count(*) filter (where ${disputes.state} = 'open')` })
      .from(disputes)
      .innerJoin(spots, eq(spots.id, disputes.spotId))
      .innerJoin(listings, eq(listings.id, spots.listingId))
      .where(others),
  ]);
  const graded = Number(spotCounts.delivered) + Number(spotCounts.overdue);
  return {
    listingsSubmitted: Number(listingCounts.submitted),
    listingsLive: Number(listingCounts.live),
    listingsRejected: Number(listingCounts.rejected),
    spotsSold: Number(spotCounts.sold),
    spotsPaidOut: Number(spotCounts.paidOut),
    spotsRefunded: Number(spotCounts.refunded),
    disputes: Number(disputeCounts.total),
    openDisputes: Number(disputeCounts.open),
    // Null until there's something to grade.
    onTimeRate: graded > 0 ? Number(spotCounts.onTime) / graded : null,
  };
}

// One listing for the reviewer decision screen, in any state, with the seller's track record.
export async function reviewListingDetail(db: Db, listingId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(listingId)) return undefined;
  const [row] = await db.select({ listing: listings, seller: sellerColumns }).from(listings).innerJoin(users, eq(users.id, listings.sellerId)).where(eq(listings.id, listingId));
  if (!row) return undefined;
  const [listing] = await hydrate(db, [row.listing]);
  return {
    ...listing,
    seller: publicSeller(row.seller),
    sellerHistory: await sellerHistory(db, row.listing.sellerId, row.listing.id),
    ...approvalRule(listing.deliveryDueAt),
  };
}

const SPONSORED = ["funded", "delivered", "disputed", "settled"];

// Public "sponsored by" data for a sold spot: the brand the sponsor chose to display.
// The sponsor's account and wallet stay private.
export async function getSponsoredSpot(db: Db, slug: string, index: number) {
  if (!Number.isInteger(index) || index < 0) return undefined;
  const listing = await getPublishedListing(db, slug);
  if (!listing) return undefined;
  const [row] = await db
    .select({ id: spots.id, index: spots.index, state: spots.state, brand: spots.brand })
    .from(spots)
    .where(and(eq(spots.listingId, listing.id), eq(spots.index, index)));
  if (!row || !SPONSORED.includes(row.state) || !row.brand) return undefined;
  return { listing, spot: { id: row.id, index: row.index, state: row.state }, brand: row.brand };
}
