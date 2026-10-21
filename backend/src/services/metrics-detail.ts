import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Prepared transactions nobody signed (a closed withdraw dialog, an expired prompt). They never reached
// the chain, so they are counted apart from real failures. Errors: "never signed", "never signed or sent".
export const ABANDONED = sql.raw(`(error like 'never signed%')`);
const SOLD = sql.raw(`('funded','delivered','disputed','settled','refunded')`);
// Spots that stayed sold: refunded ones are excluded when ranking spend.
const KEPT = sql.raw(`('funded','delivered','disputed','settled')`);

type Row = Record<string, unknown>;
const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Row[];
const int = (value: unknown) => Number(value ?? 0);
const big = (value: unknown) => BigInt((value as string | number | null | undefined) ?? 0);
const float = (value: unknown) => (value === null || value === undefined ? null : Number(value));

// Breakdowns, rankings, the user funnel, operations and extra daily series for the metrics page.
// Read-only SQL over the reconciled tables; money stays in USDC base units (bigint).
export async function metricsDetail(db: Db, now = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);
  const day = (column: string) => sql.raw(`to_char(date_trunc('day', ${column}), 'YYYY-MM-DD')`);

  const [
    bySurface,
    byMode,
    priceBuckets,
    shape,
    creators,
    sponsors,
    hotListings,
    funnel,
    txByOp,
    disputeStats,
    queue,
    overdue,
    payoutsReady,
    withdrawalStats,
    dailyListings,
    dailyBids,
    dailyDisputes,
    dailyFailed,
    dailyWithdrawn,
  ] = await Promise.all([
    db.execute(sql`
      select l.surface,
        count(distinct l.id) filter (where l.state in ('published','closed'))::int as listings,
        count(s.id) filter (where s.state in ${SOLD})::int as sold,
        coalesce(sum(st.gross) filter (where st.kind in ('payout','dispute_split')), 0)::text as settled
      from app.listings l
      left join app.spots s on s.listing_id = l.id
      left join app.settlements st on st.spot_id = s.id
      group by l.surface`),
    db.execute(sql`
      select l.mode,
        count(s.id) filter (where s.state in ${SOLD})::int as sold,
        coalesce(sum(st.gross) filter (where st.kind in ('payout','dispute_split')), 0)::text as settled,
        coalesce(sum(st.fee), 0)::text as fees
      from app.listings l
      left join app.spots s on s.listing_id = l.id
      left join app.settlements st on st.spot_id = s.id
      group by l.mode`),
    db.execute(sql`
      select case
          when amount < 5000000 then 'under $5'
          when amount < 20000000 then '$5 to $20'
          when amount < 50000000 then '$20 to $50'
          when amount < 100000000 then '$50 to $100'
          else '$100 and up' end as bucket,
        min(amount)::text as floor,
        count(*)::int as n
      from app.spots where state in ${SOLD}
      group by 1 order by min(amount)`),
    db.execute(sql`
      select
        (select count(*) from app.spots s join app.listings l on l.id = s.listing_id where l.state in ('published','closed'))::int as listed_spots,
        (select count(*) from app.spots s join app.listings l on l.id = s.listing_id where l.state in ('published','closed') and s.state in ${SOLD})::int as sold_spots,
        (select count(*) from app.listings where state in ('published','closed'))::int as live_listings,
        (select avg(s.amount::float / s.price) from app.spots s join app.listings l on l.id = s.listing_id
           where l.mode = 'auction' and s.state in ${SOLD} and s.amount is not null)::float as auction_uplift,
        (select avg(extract(epoch from reviewed_at - created_at) / 3600) from app.listings where reviewed_at is not null)::float as review_hours`),
    db.execute(sql`
      select u.handle, coalesce(sum(st.seller_net), 0)::text as earned, count(*)::int as spots
      from app.settlements st
      join app.spots s on s.id = st.spot_id
      join app.listings l on l.id = s.listing_id
      join app.users u on u.id = l.seller_id
      where st.kind in ('payout','dispute_split')
      group by u.handle order by sum(st.seller_net) desc limit 5`),
    db.execute(sql`
      select u.handle, coalesce(sum(s.amount), 0)::text as spent, count(*)::int as spots
      from app.spots s join app.users u on u.id = s.buyer_id
      where s.state in ${KEPT}
      group by u.handle order by sum(s.amount) desc limit 5`),
    db.execute(sql`
      select l.title, l.slug, u.handle, count(b.id)::int as bids, coalesce(max(b.amount), 0)::text as top_bid
      from app.bids b
      join app.spots s on s.id = b.spot_id
      join app.listings l on l.id = s.listing_id
      join app.users u on u.id = l.seller_id
      group by l.id, l.title, l.slug, u.handle
      order by count(b.id) desc limit 5`),
    db.execute(sql`
      select
        (select count(*) from app.users)::int as signed_up,
        (select count(*) from app.users where email_verified_at is not null)::int as email_verified,
        (select count(*) from app.users where onboarded_at is not null)::int as onboarded,
        (select count(distinct seller_id) from app.listings where state <> 'draft')::int as listed,
        (select count(distinct buyer_id) from app.spots where state in ${SOLD})::int as bought`),
    db.execute(sql`
      select op,
        count(*) filter (where status = 'confirmed')::int as confirmed,
        count(*) filter (where status = 'failed' and not ${ABANDONED})::int as failed,
        count(*) filter (where status = 'failed' and ${ABANDONED})::int as abandoned
      from app.chain_txs where updated_at >= ${since7}
      group by op order by count(*) desc`),
    db.execute(sql`
      select
        (select count(*) from app.disputes)::int as total,
        (select count(*) from app.spots where state in ${SOLD})::int as sold,
        (select avg(extract(epoch from closed_at - created_at) / 3600) from app.disputes where closed_at is not null)::float as hours_to_close,
        (select count(*) from app.disputes where state = 'open' and squads_transaction_index is not null)::int as waiting_on_multisig`),
    db.execute(sql`
      select count(*)::int as n, min(updated_at) as oldest from app.listings where state = 'in_review'`),
    db.execute(sql`
      select count(*)::int as n, coalesce(sum(s.amount), 0)::text as amount
      from app.spots s join app.listings l on l.id = s.listing_id
      where s.state = 'funded' and s.proof_submitted_at is null and l.delivery_due_at < ${now}`),
    db.execute(sql`
      select count(*)::int as n, coalesce(sum(s.amount), 0)::text as amount
      from app.spots s join app.listings l on l.id = s.listing_id
      where s.state = 'delivered' and l.delivery_due_at + make_interval(secs => l.review_window_seconds) < ${now}`),
    db.execute(sql`
      select
        count(*) filter (where state = 'confirmed')::int as confirmed,
        coalesce(sum(amount) filter (where state = 'confirmed'), 0)::text as amount,
        coalesce(sum(amount) filter (where state = 'confirmed' and updated_at >= ${since30}), 0)::text as last30,
        count(*) filter (where state in ('pending','submitted'))::int as in_flight
      from app.withdrawals`),
    db.execute(sql`select ${day("created_at")} as day, count(*)::int as n from app.listings where created_at >= ${since30} group by 1`),
    db.execute(sql`select ${day("created_at")} as day, count(*)::int as n from app.bids where created_at >= ${since30} group by 1`),
    db.execute(sql`select ${day("created_at")} as day, count(*)::int as n from app.disputes where created_at >= ${since30} group by 1`),
    db.execute(sql`select ${day("updated_at")} as day, count(*)::int as n from app.chain_txs where status = 'failed' and not ${ABANDONED} and updated_at >= ${since30} group by 1`),
    db.execute(sql`select ${day("updated_at")} as day, coalesce(sum(amount), 0)::text as amount from app.withdrawals where state = 'confirmed' and updated_at >= ${since30} group by 1`),
  ]);

  const shapeRow = rows(shape)[0] ?? {};
  const funnelRow = rows(funnel)[0] ?? {};
  const disputeRow = rows(disputeStats)[0] ?? {};
  const queueRow = rows(queue)[0] ?? {};
  const overdueRow = rows(overdue)[0] ?? {};
  const readyRow = rows(payoutsReady)[0] ?? {};
  const withdrawRow = rows(withdrawalStats)[0] ?? {};
  const series = (result: unknown, value: (row: Row) => number | bigint) => new Map(rows(result).map((row) => [String(row.day), value(row)]));
  const oldest = queueRow.oldest ? new Date(queueRow.oldest as string) : null;

  return {
    bySurface: rows(bySurface).map((row) => ({ surface: String(row.surface), listings: int(row.listings), sold: int(row.sold), settled: big(row.settled) })),
    byMode: rows(byMode).map((row) => ({ mode: String(row.mode), sold: int(row.sold), settled: big(row.settled), fees: big(row.fees) })),
    priceBuckets: rows(priceBuckets).map((row) => ({ bucket: String(row.bucket), count: int(row.n) })),
    sellThrough: int(shapeRow.listed_spots) ? int(shapeRow.sold_spots) / int(shapeRow.listed_spots) : null,
    spotsPerListing: int(shapeRow.live_listings) ? int(shapeRow.listed_spots) / int(shapeRow.live_listings) : null,
    auctionUplift: float(shapeRow.auction_uplift),
    reviewHours: float(shapeRow.review_hours),
    topCreators: rows(creators).map((row) => ({ handle: String(row.handle), earned: big(row.earned), spots: int(row.spots) })),
    topSponsors: rows(sponsors).map((row) => ({ handle: String(row.handle), spent: big(row.spent), spots: int(row.spots) })),
    topListings: rows(hotListings).map((row) => ({ title: String(row.title), slug: String(row.slug), handle: String(row.handle), bids: int(row.bids), topBid: big(row.top_bid) })),
    funnel: {
      signedUp: int(funnelRow.signed_up),
      emailVerified: int(funnelRow.email_verified),
      onboarded: int(funnelRow.onboarded),
      listed: int(funnelRow.listed),
      bought: int(funnelRow.bought),
    },
    txByOp: rows(txByOp).map((row) => ({ op: String(row.op), confirmed: int(row.confirmed), failed: int(row.failed), abandoned: int(row.abandoned) })),
    abandonedTxsLast7: rows(txByOp).reduce((total, row) => total + int(row.abandoned), 0),
    disputes: {
      rate: int(disputeRow.sold) ? int(disputeRow.total) / int(disputeRow.sold) : null,
      hoursToClose: float(disputeRow.hours_to_close),
      waitingOnMultisig: int(disputeRow.waiting_on_multisig),
    },
    reviewQueue: { waiting: int(queueRow.n), oldestHours: oldest ? (now.getTime() - oldest.getTime()) / (60 * 60 * 1000) : null },
    overdueDeliveries: { count: int(overdueRow.n), amount: big(overdueRow.amount) },
    payoutsReady: { count: int(readyRow.n), amount: big(readyRow.amount) },
    withdrawals: { confirmed: int(withdrawRow.confirmed), amount: big(withdrawRow.amount), last30: big(withdrawRow.last30), inFlight: int(withdrawRow.in_flight) },
    daily: {
      listings: series(dailyListings, (row) => int(row.n)),
      bids: series(dailyBids, (row) => int(row.n)),
      disputes: series(dailyDisputes, (row) => int(row.n)),
      failedTxs: series(dailyFailed, (row) => int(row.n)),
      withdrawn: series(dailyWithdrawn, (row) => big(row.amount)),
    },
  };
}
