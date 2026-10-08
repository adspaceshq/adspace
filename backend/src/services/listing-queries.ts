import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listings, spots, users } from "../db/schema.js";

type ListingRow = typeof listings.$inferSelect;
type SpotRow = typeof spots.$inferSelect;

const sellerColumns = {
  id: users.id,
  handle: users.handle,
  displayName: users.displayName,
  avatarUrl: users.avatarUrl,
  hasX: users.xUserId,
};

async function withSpots(db: Db, rows: ListingRow[]): Promise<Array<ListingRow & { spots: SpotRow[] }>> {
  if (rows.length === 0) return [];
  const all = await db
    .select()
    .from(spots)
    .where(inArray(spots.listingId, rows.map((row) => row.id)))
    .orderBy(asc(spots.index));
  return rows.map((row) => ({ ...row, spots: all.filter((spot) => spot.listingId === row.id) }));
}

// Buyers' identities and wallets are not public; only state and amounts are.
export function publicSpot(spot: SpotRow) {
  return {
    id: spot.id,
    index: spot.index,
    label: spot.label,
    price: spot.price,
    layout: spot.layout,
    state: spot.state,
    amount: spot.amount,
    taken: spot.state !== "open" && spot.state !== "cancelled",
  };
}

export async function getPublishedListing(db: Db, slug: string) {
  const [row] = await db
    .select({ listing: listings, seller: sellerColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(and(eq(listings.slug, slug), inArray(listings.state, ["published", "closed"])));
  if (!row) return undefined;
  const [listing] = await withSpots(db, [row.listing]);
  return { ...listing, spots: listing.spots.map(publicSpot), seller: { ...row.seller, hasX: Boolean(row.seller.hasX) } };
}

export async function listPublished(db: Db, limit = 50) {
  const rows = await db
    .select()
    .from(listings)
    .where(eq(listings.state, "published"))
    .orderBy(asc(listings.deadline))
    .limit(limit);
  return (await withSpots(db, rows)).map((listing) => ({ ...listing, spots: listing.spots.map(publicSpot) }));
}

export async function listForSeller(db: Db, sellerId: string) {
  const rows = await db.select().from(listings).where(eq(listings.sellerId, sellerId)).orderBy(desc(listings.updatedAt));
  return withSpots(db, rows);
}

export async function reviewQueue(db: Db) {
  const rows = await db
    .select({ listing: listings, seller: sellerColumns })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(listings.state, "in_review"))
    .orderBy(asc(listings.updatedAt));
  const hydrated = await withSpots(db, rows.map((row) => row.listing));
  return hydrated.map((listing, index) => ({ ...listing, seller: { ...rows[index].seller, hasX: Boolean(rows[index].seller.hasX) } }));
}
