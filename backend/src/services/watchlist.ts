import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listings, watchlist } from "../db/schema.js";
import { getPublishedListing } from "./listing-queries.js";

class WatchlistError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only public listings can be saved; saving twice is a no-op.
export async function watchListing(db: Db, userId: string, listingId: string) {
  if (!UUID.test(listingId)) throw new WatchlistError("listing not found", 404);
  const [listing] = await db
    .select({ id: listings.id, sellerId: listings.sellerId })
    .from(listings)
    .where(and(eq(listings.id, listingId), inArray(listings.state, ["published", "closed"])));
  if (!listing) throw new WatchlistError("listing not found", 404);
  if (listing.sellerId === userId) throw new WatchlistError("you can't save your own listing", 400);
  await db.insert(watchlist).values({ userId, listingId }).onConflictDoNothing();
  return { listingId, watching: true };
}

export async function unwatchListing(db: Db, userId: string, listingId: string) {
  if (!UUID.test(listingId)) throw new WatchlistError("listing not found", 404);
  await db.delete(watchlist).where(and(eq(watchlist.userId, userId), eq(watchlist.listingId, listingId)));
  return { listingId, watching: false };
}

// Newest saves first; listings that left the public feed (drafts, takedowns) drop out.
export async function listWatchlist(db: Db, userId: string) {
  const rows = await db
    .select({ slug: listings.slug, savedAt: watchlist.createdAt })
    .from(watchlist)
    .innerJoin(listings, eq(listings.id, watchlist.listingId))
    .where(and(eq(watchlist.userId, userId), inArray(listings.state, ["published", "closed"])))
    .orderBy(desc(watchlist.createdAt))
    .limit(100);
  const items = await Promise.all(rows.map(async (row) => ({ savedAt: row.savedAt, listing: await getPublishedListing(db, row.slug) })));
  return items.filter((item) => item.listing !== undefined);
}
