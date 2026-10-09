import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { bids, chainTxs, spots } from "../db/schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public bid history for one spot. Bidders are numbered by their first bid on this spot;
// accounts and wallets are never exposed, but the viewer sees which bids are theirs.
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
  const items = rows
    .map((row, index) => ({
      id: row.id.toString(),
      amount: row.amount,
      createdAt: row.createdAt,
      signature: row.signature,
      bidder: `bidder ${numbers.get(row.bidderId)}`,
      isYou: Boolean(viewerId && row.bidderId === viewerId),
      isTop: leading && index === rows.length - 1,
    }))
    .reverse();
  return { spotId, bidders: numbers.size, items };
}
