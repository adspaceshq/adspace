import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bids, chainTxs, spots, users } from "../db/schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public bid history for one spot. Each bid shows the bidder's public adspaces profile (handle,
// name, avatar) so anyone can click through; wallets are never exposed. Bidders are also numbered
// by their first bid, and the viewer sees which bids are theirs.
export async function spotBidHistory(db: Db, spotId: string, viewerId?: string) {
  if (!UUID.test(spotId)) return undefined;
  const [spot] = await db.select({ id: spots.id, state: spots.state }).from(spots).where(eq(spots.id, spotId));
  if (!spot) return undefined;
  const rows = await db
    .select({ id: bids.id, bidderId: bids.bidderId, amount: bids.amount, createdAt: bids.createdAt, signature: chainTxs.signature })
    .from(bids)
    .leftJoin(chainTxs, eq(chainTxs.id, bids.chainTxId))
    .where(eq(bids.spotId, spotId))
    .orderBy(asc(bids.createdAt), asc(bids.id));
  const numbers = new Map<string, number>();
  for (const row of rows) if (!numbers.has(row.bidderId)) numbers.set(row.bidderId, numbers.size + 1);
  const leading = ["funded", "delivered", "disputed", "settled"].includes(spot.state);
  const bidderIds = [...numbers.keys()];
  const profiles = new Map(
    bidderIds.length
      ? (
          await db
            .select({ id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl })
            .from(users)
            .where(inArray(users.id, bidderIds))
        ).map(({ id, ...profile }) => [id, profile])
      : [],
  );
  const items = rows
    .map((row, index) => ({
      id: row.id.toString(),
      amount: row.amount,
      createdAt: row.createdAt,
      signature: row.signature,
      bidder: `bidder ${numbers.get(row.bidderId)}`,
      profile: profiles.get(row.bidderId) ?? null,
      isYou: Boolean(viewerId && row.bidderId === viewerId),
      isTop: leading && index === rows.length - 1,
    }))
    .reverse();
  return { spotId, bidders: numbers.size, items };
}
