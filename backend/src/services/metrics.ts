import { and, count, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { PublicKey, type Connection } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { bids, chainTxs, disputes, listings, settlements, spotEvents, spots, users } from "../db/schema.js";
import { ABANDONED, metricsDetail } from "./metrics-detail.js";

const DAY_MS = 24 * 60 * 60 * 1000;
// Spots whose USDC sits in their vault right now.
const HELD = ["funded", "delivered", "disputed"] as const;
// Spots a sponsor paid for at some point (refunded ones included: the sale happened, then was undone).
const SOLD = ["funded", "delivered", "disputed", "settled", "refunded"] as const;

export interface ChainMetrics {
  feePayerLamports: number | null;
  minFeePayerLamports: number;
  treasuryUsdc: bigint | null;
  // Sum of the USDC actually in the held spots' vaults, to check against the database.
  escrowOnChain: bigint | null;
}

const sum = (column: unknown) => sql<string>`coalesce(sum(${column}), 0)::text`;
const big = (value: string | number | null | undefined) => BigInt(value ?? 0);

// Admin numbers for the metrics page. Money is USDC base units as bigint; the router turns it into strings.
// Everything comes from the database (the reconciled copy of the chain) except `chain`, read live by the caller.
export async function adminMetrics(db: Db, chain: ChainMetrics | null, now = new Date()) {
  const since7 = new Date(now.getTime() - 7 * DAY_MS);
  const since30 = new Date(now.getTime() - 30 * DAY_MS);

  const detailPromise = metricsDetail(db, now);
  const [
    settledAll,
    settled7,
    settled30,
    settledByKind,
    escrow,
    escrowByState,
    listingStates,
    spotStates,
    modes,
    sale,
    bidStats,
    firstSale,
    userTotals,
    intents,
    activeUsers,
    repeatSponsors,
    disputeStates,
    failed7,
    dailySettled,
    dailySales,
    dailySignups,
  ] = await Promise.all([
    db.select({ gross: sum(settlements.gross), fee: sum(settlements.fee), net: sum(settlements.sellerNet), refunds: sum(settlements.buyerRefund) }).from(settlements),
    db.select({ gross: sum(settlements.gross), fee: sum(settlements.fee) }).from(settlements).where(gte(settlements.settledAt, since7)),
    db.select({ gross: sum(settlements.gross), fee: sum(settlements.fee) }).from(settlements).where(gte(settlements.settledAt, since30)),
    db.select({ kind: settlements.kind, n: count() }).from(settlements).groupBy(settlements.kind),
    db.select({ amount: sum(spots.amount), n: count() }).from(spots).where(inArray(spots.state, [...HELD])),
    db.select({ state: spots.state, amount: sum(spots.amount), n: count() }).from(spots).where(inArray(spots.state, [...HELD])).groupBy(spots.state),
    db.select({ state: listings.state, n: count() }).from(listings).groupBy(listings.state),
    db.select({ state: spots.state, n: count() }).from(spots).groupBy(spots.state),
    db
      .select({ mode: listings.mode, n: count() })
      .from(listings)
      .where(inArray(listings.state, ["published", "closed"]))
      .groupBy(listings.mode),
    db.select({ avg: sql<string>`coalesce(avg(${spots.amount}), 0)::bigint::text`, n: count() }).from(spots).where(inArray(spots.state, [...SOLD])),
    db
      .select({ bids: count(bids.id), spots: sql<number>`count(distinct ${bids.spotId})::int` })
      .from(bids),
    // Hours from going live to the first sale, per listing that sold.
    db.execute(sql`
      select coalesce(avg(extract(epoch from first_sale - l.published_at) / 3600), 0)::float as hours, count(*)::int as n
      from ${listings} l
      join (
        select s.listing_id, min(e.created_at) as first_sale
        from ${spotEvents} e join ${spots} s on s.id = e.spot_id
        where e.from_state = 'open' and e.to_state = 'funded'
        group by s.listing_id
      ) f on f.listing_id = l.id
      where l.published_at is not null`),
    db
      .select({
        total: count(),
        last7: sql<number>`count(*) filter (where ${users.createdAt} >= ${since7})::int`,
        onboarded: sql<number>`count(*) filter (where ${users.onboardedAt} is not null)::int`,
      })
      .from(users),
    db.select({ intent: users.intent, n: count() }).from(users).where(isNotNull(users.intent)).groupBy(users.intent),
    db
      .select({ n: sql<number>`count(distinct ${chainTxs.actorId})::int` })
      .from(chainTxs)
      .where(and(eq(chainTxs.status, "confirmed"), gte(chainTxs.confirmedAt, since7))),
    db.execute(sql`
      select count(*)::int as n from (
        select buyer_id from ${spots} where state in ('funded','delivered','disputed','settled','refunded') and buyer_id is not null
        group by buyer_id having count(*) >= 2
      ) r`),
    db.select({ state: disputes.state, n: count() }).from(disputes).groupBy(disputes.state),
    db.select({ n: count() }).from(chainTxs).where(and(eq(chainTxs.status, "failed"), sql`not ${ABANDONED}`, gte(chainTxs.updatedAt, since7))),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${settlements.settledAt}), 'YYYY-MM-DD')`, gross: sum(settlements.gross), fee: sum(settlements.fee) })
      .from(settlements)
      .where(gte(settlements.settledAt, since30))
      .groupBy(sql`1`),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${spotEvents.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(spotEvents)
      .where(and(eq(spotEvents.fromState, "open"), eq(spotEvents.toState, "funded"), gte(spotEvents.createdAt, since30)))
      .groupBy(sql`1`),
    db
      .select({ day: sql<string>`to_char(date_trunc('day', ${users.createdAt}), 'YYYY-MM-DD')`, n: count() })
      .from(users)
      .where(gte(users.createdAt, since30))
      .groupBy(sql`1`),
  ]);

  const rows = (result: unknown) => ((result as { rows?: unknown[] }).rows ?? (result as unknown[])) as Array<Record<string, unknown>>;
  const tally = <K extends string>(list: Array<{ n: number } & Record<string, unknown>>, key: string) =>
    Object.fromEntries(list.map((row) => [row[key] as K, Number(row.n)])) as Record<K, number>;

  // 30 days, oldest first, with empty days filled in.
  const days = Array.from({ length: 30 }, (_, index) => new Date(now.getTime() - (29 - index) * DAY_MS).toISOString().slice(0, 10));
  const byDay = <T>(list: Array<{ day: string } & T>) => new Map(list.map((row) => [row.day, row]));
  const settledDays = byDay(dailySettled);
  const salesDays = byDay(dailySales);
  const signupDays = byDay(dailySignups);

  const detail = await detailPromise;
  const escrowDb = big(escrow[0]?.amount);
  const first = rows(firstSale)[0] ?? {};
  return {
    generatedAt: now,
    money: {
      settledGross: { all: big(settledAll[0]?.gross), last7: big(settled7[0]?.gross), last30: big(settled30[0]?.gross) },
      fees: { all: big(settledAll[0]?.fee), last7: big(settled7[0]?.fee), last30: big(settled30[0]?.fee) },
      creatorPayouts: big(settledAll[0]?.net),
      refunds: big(settledAll[0]?.refunds),
      settlementsByKind: tally(settledByKind, "kind"),
      escrow: {
        amount: escrowDb,
        spots: Number(escrow[0]?.n ?? 0),
        onChain: chain?.escrowOnChain ?? null,
        matches: chain?.escrowOnChain == null ? null : chain.escrowOnChain === escrowDb,
      },
      treasury: chain?.treasuryUsdc ?? null,
      escrowByState: tally(escrowByState, "state"),
      escrowAmountByState: Object.fromEntries(escrowByState.map((row) => [row.state, big(row.amount)])),
      byMode: detail.byMode,
      // Fees over the settled amount that paid a creator (full refunds carry no fee).
      feeRateBps: (() => {
        const paid = detail.byMode.reduce((total, row) => total + row.settled, 0n);
        return paid > 0n ? Number((big(settledAll[0]?.fee) * 10_000n) / paid) : null;
      })(),
      payoutsReady: detail.payoutsReady,
      withdrawals: detail.withdrawals,
    },
    marketplace: {
      listingsByState: tally(listingStates, "state"),
      spotsByState: tally(spotStates, "state"),
      liveListingsByMode: tally(modes, "mode"),
      spotsSold: Number(sale[0]?.n ?? 0),
      averageSale: big(sale[0]?.avg),
      bids: Number(bidStats[0]?.bids ?? 0),
      averageBidsPerAuctionSpot: Number(bidStats[0]?.spots ?? 0) ? Number(bidStats[0].bids) / Number(bidStats[0].spots) : 0,
      hoursToFirstSale: Number(first.n ?? 0) ? Number(first.hours) : null,
      bySurface: detail.bySurface,
      priceBuckets: detail.priceBuckets,
      sellThrough: detail.sellThrough,
      spotsPerListing: detail.spotsPerListing,
      auctionUplift: detail.auctionUplift,
      reviewHours: detail.reviewHours,
      topCreators: detail.topCreators,
      topSponsors: detail.topSponsors,
      topListings: detail.topListings,
    },
    users: {
      total: Number(userTotals[0]?.total ?? 0),
      newLast7: Number(userTotals[0]?.last7 ?? 0),
      onboarded: Number(userTotals[0]?.onboarded ?? 0),
      byIntent: tally(intents, "intent"),
      activeLast7: Number(activeUsers[0]?.n ?? 0),
      repeatSponsors: Number(rows(repeatSponsors)[0]?.n ?? 0),
      funnel: detail.funnel,
    },
    health: {
      disputesByState: tally(disputeStates, "state"),
      failedTxsLast7: Number(failed7[0]?.n ?? 0),
      feePayerSol: chain?.feePayerLamports == null ? null : chain.feePayerLamports / 1e9,
      feePayerLow: chain?.feePayerLamports == null ? null : chain.feePayerLamports < chain.minFeePayerLamports,
      minFeePayerSol: chain ? chain.minFeePayerLamports / 1e9 : null,
      txByOp: detail.txByOp,
      abandonedTxsLast7: detail.abandonedTxsLast7,
      disputes: detail.disputes,
      reviewQueue: detail.reviewQueue,
      overdueDeliveries: detail.overdueDeliveries,
    },
    daily: days.map((day) => ({
      day,
      settledGross: big(settledDays.get(day)?.gross),
      fees: big(settledDays.get(day)?.fee),
      sales: Number(salesDays.get(day)?.n ?? 0),
      signups: Number(signupDays.get(day)?.n ?? 0),
      listings: detail.daily.listings.get(day) ?? 0,
      bids: detail.daily.bids.get(day) ?? 0,
      disputes: detail.daily.disputes.get(day) ?? 0,
      failedTxs: detail.daily.failedTxs.get(day) ?? 0,
      withdrawn: detail.daily.withdrawn.get(day) ?? 0n,
    })),
  };
}

export type AdminMetrics = Awaited<ReturnType<typeof adminMetrics>>;

// Live chain numbers for the metrics page. Each read is independent: one failing RPC call blanks that
// number instead of failing the page.
export async function readChainMetrics(
  db: Db,
  chain: {
    connection: Connection;
    rentPayer: { publicKey: PublicKey };
    readProtocolStatus: () => Promise<{ treasury: PublicKey }>;
    readTokenBalance: (owner: PublicKey) => Promise<bigint>;
  },
  minFeePayerLamports: number,
): Promise<ChainMetrics> {
  const held = await db
    .select({ vault: spots.vaultAddress })
    .from(spots)
    .where(and(inArray(spots.state, [...HELD]), isNotNull(spots.vaultAddress)));
  const escrowOnChain = async () => {
    let total = 0n;
    for (let index = 0; index < held.length; index += 100) {
      const keys = held.slice(index, index + 100).map((row) => new PublicKey(row.vault!));
      const infos = await chain.connection.getMultipleAccountsInfo(keys, "confirmed");
      // SPL token account: the amount is a little-endian u64 at byte 64.
      for (const info of infos) if (info) total += info.data.readBigUInt64LE(64);
    }
    return total;
  };
  const [feePayer, treasury, escrowTotal] = await Promise.all([
    chain.connection.getBalance(chain.rentPayer.publicKey, "confirmed").catch(() => null),
    chain.readProtocolStatus().then((status) => chain.readTokenBalance(status.treasury)).catch(() => null),
    escrowOnChain().catch(() => null),
  ]);
  return { feePayerLamports: feePayer, minFeePayerLamports, treasuryUsdc: treasury, escrowOnChain: escrowTotal };
}
