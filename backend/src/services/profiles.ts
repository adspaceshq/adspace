import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listings, spots, users } from "../db/schema.js";
import { getPublishedListing } from "./listing-queries.js";

const SOLD = ["funded", "delivered", "disputed", "settled"] as const;

// Everything on a public profile page: identity, track record and listings. Aggregates only;
// buyers, amounts and wallets stay private.
export async function publicProfilePage(db: Db, handle: string, now = new Date()) {
  const clean = handle.trim().replace(/^@+/, "").toLowerCase();
  if (!clean) return undefined;
  const [user] = await db.select().from(users).where(sql`lower(${users.handle}) = ${clean}`);
  if (!user) return undefined;

  const [record] = await db
    .select({
      sold: sql<number>`count(*) filter (where ${inArray(spots.state, [...SOLD])})`,
      delivered: sql<number>`count(*) filter (where ${spots.proofSubmittedAt} is not null)`,
      onTime: sql<number>`count(*) filter (where ${spots.proofSubmittedAt} <= ${listings.deliveryDueAt})`,
      overdue: sql<number>`count(*) filter (where ${spots.state} = 'funded' and ${spots.proofSubmittedAt} is null and ${listings.deliveryDueAt} < ${now})`,
    })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(listings.sellerId, user.id));
  const [sponsored] = await db
    .select({ count: sql<number>`count(*)` })
    .from(spots)
    .where(and(eq(spots.buyerId, user.id), inArray(spots.state, [...SOLD])));

  const rows = await db
    .select({ slug: listings.slug })
    .from(listings)
    .where(and(eq(listings.sellerId, user.id), inArray(listings.state, ["published", "closed"])))
    .orderBy(sql`${listings.deadline} < ${now}`, desc(listings.publishedAt))
    .limit(24);
  const items = (await Promise.all(rows.map((row) => getPublishedListing(db, row.slug)))).filter((item) => item !== undefined);

  const onboarding = user.onboarding as { creator?: { socials?: Record<string, string> } } | null;
  const graded = Number(record.delivered) + Number(record.overdue);
  return {
    id: user.id,
    handle: user.handle,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    verified: user.verified,
    hasX: Boolean(user.xUserId),
    memberSince: user.createdAt,
    socials: onboarding?.creator?.socials ?? {},
    stats: {
      spotsSold: Number(record.sold),
      spotsSponsored: Number(sponsored.count),
      deliveries: Number(record.delivered),
      // Null until there's something to grade, so new creators don't show 0%.
      onTimeRate: graded > 0 ? Number(record.onTime) / graded : null,
      activeListings: items.filter((item) => item.state === "published" && item.deadline > now).length,
    },
    listings: items,
  };
}
