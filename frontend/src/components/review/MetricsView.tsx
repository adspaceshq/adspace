"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { AdminMetrics } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { cx } from "@/lib/cx";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { userErrorMessage } from "@/lib/errors";
import { listingHref, profileHref, SURFACE_LABELS } from "@/lib/listing-display";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { DailyBars, type DailyPoint } from "./DailyBars";
import { HBars } from "./HBars";

const TABS = ["overview", "money", "marketplace", "users", "health"] as const;
type Tab = (typeof TABS)[number];

const usd = (value: string | null | undefined) => (value == null ? "unavailable" : formatUsd(value));
const pct = (value: number | null, digits = 0) => (value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`);
const hours = (value: number | null) => (value === null ? "n/a" : value < 1 ? `${Math.max(1, Math.round(value * 60))} min` : value < 48 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} days`);
const sumOf = (record: Partial<Record<string, number>>) => Object.values(record).reduce<number>((total, value) => total + (value ?? 0), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Admin numbers on one screen per tab: the page itself never scrolls on desktop; each tab's panel does,
// with a scrollbar that only shows while hovered. Phones get a normal scrolling page.
export function MetricsView() {
  const params = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const query = useQuery({ queryKey: queryKeys.adminMetrics, queryFn: () => api.admin.metrics(), refetchInterval: 60_000 });

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-15rem)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/review" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
            <ArrowLeft className="size-4" aria-hidden /> queue
          </Link>
          <h1 className="text-title font-semibold">metrics</h1>
          <p className="text-small text-muted">
            {ADSPACES_CLUSTER === "mainnet-beta" ? "mainnet" : `${ADSPACES_CLUSTER}: test money, includes seeded demo data`}
            {query.data && ` · updated ${new Date(query.data.generatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
          <RefreshCw className="size-4" aria-hidden /> refresh
        </Button>
      </div>
      <Tabs active={`/review/metrics?tab=${tab}`} items={TABS.map((item) => ({ href: `/review/metrics?tab=${item}`, label: item }))} />
      <div className="min-h-0 flex-1 lg:-mr-2 lg:overflow-y-auto lg:pr-2 hover-scrollbar">
        {query.isPending ? (
          <SkeletonGroup label="loading metrics">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((key) => (
                <Skeleton key={key} className="h-24" />
              ))}
            </div>
          </SkeletonGroup>
        ) : query.isError ? (
          <EmptyState
            icon={AlertTriangle}
            title="couldn't load metrics"
            description={userErrorMessage(query.error, "try again in a minute.")}
            action={<Button onClick={() => void query.refetch()}>try again</Button>}
          />
        ) : (
          <TabBody tab={tab} data={query.data} />
        )}
      </div>
    </div>
  );
}

function TabBody({ tab, data }: { tab: Tab; data: AdminMetrics }) {
  if (tab === "money") return <MoneyTab data={data} />;
  if (tab === "marketplace") return <MarketplaceTab data={data} />;
  if (tab === "users") return <UsersTab data={data} />;
  if (tab === "health") return <HealthTab data={data} />;
  return <OverviewTab data={data} />;
}

// ---------- building blocks ----------

type Status = { ok: boolean; text: string };

function Tile({ label, value, detail, status }: { label: string; value: string; detail?: React.ReactNode; status?: Status }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-card border border-line bg-surface p-3 shadow-card">
      <span className="text-small text-muted">{label}</span>
      <span className="text-lead font-semibold tabular-nums">{value}</span>
      {detail && <span className="text-caption text-muted">{detail}</span>}
      {status && (
        <span className={cx("mt-0.5 inline-flex items-center gap-1 text-caption font-medium", status.ok ? "text-success" : "text-danger")}>
          {status.ok ? <CheckCircle2 className="size-3.5" aria-hidden /> : <AlertTriangle className="size-3.5" aria-hidden />}
          {status.text}
        </span>
      )}
    </div>
  );
}

function Breakdown({ title, rows, className }: { title: string; rows: Array<[React.ReactNode, number | string]>; className?: string }) {
  return (
    <div className={cx("rounded-card border border-line bg-surface p-3 shadow-card", className)}>
      <h3 className="mb-1 text-small font-medium text-muted">{title}</h3>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([label, value], index) => (
          <div key={index} className="flex items-center justify-between gap-3 py-1 text-small">
            <dt className="min-w-0 truncate">{label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const Grid = ({ cols = 4, children }: { cols?: 2 | 3 | 4; children: React.ReactNode }) => (
  <div className={cx("grid gap-3 sm:grid-cols-2", cols === 4 ? "lg:grid-cols-4" : cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2")}>{children}</div>
);

type Day = AdminMetrics["daily"][number];
const daily = (data: AdminMetrics, pick: (day: Day) => number, label: (value: number) => string): DailyPoint[] =>
  data.daily.map((day) => ({ day: day.day, value: pick(day), label: label(pick(day)) }));
const dailyUsd = (data: AdminMetrics, pick: (day: Day) => string): DailyPoint[] =>
  data.daily.map((day) => ({ day: day.day, value: Number(BigInt(pick(day))) / 1e6, label: formatUsd(pick(day)) }));
const total = (data: AdminMetrics, pick: (day: Day) => number) => data.daily.reduce((sum, day) => sum + pick(day), 0);
const totalUsd = (data: AdminMetrics, pick: (day: Day) => string) => formatUsd(data.daily.reduce((sum, day) => sum + BigInt(pick(day)), 0n));
const amount = (value: string | undefined) => Number(BigInt(value ?? "0"));

function escrowStatus(data: AdminMetrics): Status | undefined {
  const { escrow } = data.money;
  if (escrow.matches === null) return undefined;
  return escrow.matches ? { ok: true, text: "matches the vaults on-chain" } : { ok: false, text: `vaults hold ${usd(escrow.onChain)}` };
}

function feePayerStatus(data: AdminMetrics): Status | undefined {
  const { health } = data;
  if (health.feePayerLow === null) return undefined;
  return health.feePayerLow ? { ok: false, text: `below ${health.minFeePayerSol} SOL: top it up` } : { ok: true, text: "funded" };
}

const profileLink = (handle: string) => (
  <Link key={handle} href={profileHref(handle)} className="hover:text-accent hover:underline">
    @{handle}
  </Link>
);

// ---------- tabs ----------

function OverviewTab({ data }: { data: AdminMetrics }) {
  const { money, marketplace, users, health } = data;
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Tile label="settled sales" value={formatUsd(money.settledGross.all)} detail={`7 days ${formatUsd(money.settledGross.last7)}`} />
        <Tile label="platform fees" value={formatUsd(money.fees.all)} detail={`7 days ${formatUsd(money.fees.last7)}`} />
        <Tile label="in escrow now" value={formatUsd(money.escrow.amount)} detail={plural(money.escrow.spots, "spot")} status={escrowStatus(data)} />
        <Tile label="treasury (on-chain)" value={usd(money.treasury)} detail="fees in the multisig treasury" />
        <Tile label="spots sold" value={String(marketplace.spotsSold)} detail={`sell-through ${pct(marketplace.sellThrough)}`} />
        <Tile label="users" value={String(users.total)} detail={`${users.newLast7} new · ${users.activeLast7} active in 7 days`} />
        <Tile
          label="open disputes"
          value={String(health.disputesByState.open ?? 0)}
          detail={
            <Link href="/review?tab=disputes" className="text-accent hover:underline">
              dispute queue
            </Link>
          }
        />
        <Tile label="fee and rent payer" value={health.feePayerSol === null ? "unavailable" : `${health.feePayerSol.toFixed(2)} SOL`} status={feePayerStatus(data)} />
      </Grid>
      <Grid cols={3}>
        <DailyBars compact title="settled sales, 30 days" total={totalUsd(data, (day) => day.settledGross)} points={dailyUsd(data, (day) => day.settledGross)} />
        <DailyBars compact title="spots sold, 30 days" total={String(total(data, (day) => day.sales))} points={daily(data, (day) => day.sales, (n) => plural(n, "sale"))} />
        <DailyBars compact title="sign-ups, 30 days" total={String(total(data, (day) => day.signups))} points={daily(data, (day) => day.signups, (n) => plural(n, "sign-up"))} />
      </Grid>
    </div>
  );
}

function MoneyTab({ data }: { data: AdminMetrics }) {
  const { money } = data;
  const stages = money.escrowAmountByState;
  const stage = (label: string, key: "funded" | "delivered" | "disputed") => ({
    label,
    value: amount(stages[key]),
    display: usd(stages[key] ?? "0"),
    hint: plural(money.escrowByState[key] ?? 0, "spot"),
  });
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Tile label="settled sales" value={formatUsd(money.settledGross.all)} detail={`7 days ${formatUsd(money.settledGross.last7)} · 30 days ${formatUsd(money.settledGross.last30)}`} />
        <Tile
          label="platform fees"
          value={formatUsd(money.fees.all)}
          detail={`effective rate ${money.feeRateBps === null ? "n/a" : `${(money.feeRateBps / 100).toFixed(2)}%`} · 30 days ${formatUsd(money.fees.last30)}`}
        />
        <Tile label="in escrow now" value={formatUsd(money.escrow.amount)} detail={plural(money.escrow.spots, "spot")} status={escrowStatus(data)} />
        <Tile label="payouts ready" value={formatUsd(money.payoutsReady.amount)} detail={`${plural(money.payoutsReady.count, "spot")} past the review window`} />
      </Grid>
      <Grid cols={3}>
        <DailyBars compact title="settled sales, 30 days" total={totalUsd(data, (day) => day.settledGross)} points={dailyUsd(data, (day) => day.settledGross)} />
        <DailyBars compact title="platform fees, 30 days" total={totalUsd(data, (day) => day.fees)} points={dailyUsd(data, (day) => day.fees)} />
        <DailyBars compact title="wallet withdrawals, 30 days" total={totalUsd(data, (day) => day.withdrawn)} points={dailyUsd(data, (day) => day.withdrawn)} />
      </Grid>
      <Grid>
        <HBars title="escrow by stage" rows={[stage("paid, awaiting delivery", "funded"), stage("delivered, in review", "delivered"), stage("disputed", "disputed")]} />
        <HBars
          title="settled by pricing"
          rows={money.byMode.map((row) => ({
            label: row.mode === "auction" ? "auction" : "fixed price",
            value: amount(row.settled),
            display: formatUsd(row.settled),
            hint: `${plural(row.sold, "sale")} · fees ${formatUsd(row.fees)}`,
          }))}
        />
        <Breakdown
          title="where settled money went"
          rows={[
            ["to creators", formatUsd(money.creatorPayouts)],
            ["refunded to sponsors", formatUsd(money.refunds)],
            ["platform fees", formatUsd(money.fees.all)],
            [
              "paid · split · refunded",
              `${money.settlementsByKind.payout ?? 0} · ${money.settlementsByKind.dispute_split ?? 0} · ${(money.settlementsByKind.refund ?? 0) + (money.settlementsByKind.timeout_refund ?? 0)}`,
            ],
          ]}
        />
        <Breakdown
          title="treasury and withdrawals"
          rows={[
            ["treasury (on-chain)", usd(money.treasury)],
            ["withdrawn to wallets", formatUsd(money.withdrawals.amount)],
            ["withdrawn in 30 days", formatUsd(money.withdrawals.last30)],
            ["confirmed · in flight", `${money.withdrawals.confirmed} · ${money.withdrawals.inFlight}`],
          ]}
        />
      </Grid>
    </div>
  );
}

function MarketplaceTab({ data }: { data: AdminMetrics }) {
  const { marketplace } = data;
  const spots = marketplace.spotsByState;
  const listings = marketplace.listingsByState;
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Tile label="spots sold" value={String(marketplace.spotsSold)} detail={`sell-through ${pct(marketplace.sellThrough)} of ${sumOf(spots)} spots`} />
        <Tile label="average sale" value={formatUsd(marketplace.averageSale)} detail={`${marketplace.spotsPerListing?.toFixed(1) ?? "n/a"} spots per listing`} />
        <Tile
          label="auctions"
          value={marketplace.auctionUplift === null ? "n/a" : `+${Math.round((marketplace.auctionUplift - 1) * 100)}%`}
          detail={`above the starting price · ${marketplace.averageBidsPerAuctionSpot.toFixed(1)} bids per spot`}
        />
        <Tile label="speed" value={hours(marketplace.hoursToFirstSale)} detail={`live to first sale · review ${hours(marketplace.reviewHours)}`} />
      </Grid>
      <Grid cols={3}>
        <DailyBars compact title="new listings, 30 days" total={String(total(data, (day) => day.listings))} points={daily(data, (day) => day.listings, (n) => plural(n, "listing"))} />
        <DailyBars compact title="bids, 30 days" total={String(total(data, (day) => day.bids))} points={daily(data, (day) => day.bids, (n) => plural(n, "bid"))} />
        <HBars
          title="sold spots by price"
          rows={marketplace.priceBuckets.map((row) => ({
            label: row.bucket,
            value: row.count,
            display: String(row.count),
            hint: pct(marketplace.spotsSold ? row.count / marketplace.spotsSold : null),
          }))}
        />
      </Grid>
      <Grid>
        <HBars
          title="sales by surface"
          rows={[...marketplace.bySurface]
            .sort((a, b) => b.sold - a.sold)
            .map((row) => ({
              label: SURFACE_LABELS[row.surface] ?? row.surface,
              value: row.sold,
              display: String(row.sold),
              hint: `${plural(row.listings, "listing")} · ${formatUsd(row.settled)} settled`,
            }))}
        />
        <Breakdown
          title="listings"
          rows={[
            ["in review", listings.in_review ?? 0],
            ["live", (listings.published ?? 0) + (listings.publishing ?? 0)],
            ["closed", listings.closed ?? 0],
            ["drafts · changes requested", `${listings.draft ?? 0} · ${listings.changes_requested ?? 0}`],
            ["rejected", listings.rejected ?? 0],
          ]}
        />
        <Breakdown
          title="spots"
          rows={[
            ["open", spots.open ?? 0],
            ["paid · delivered", `${spots.funded ?? 0} · ${spots.delivered ?? 0}`],
            ["disputed", spots.disputed ?? 0],
            ["settled", spots.settled ?? 0],
            ["refunded or cancelled", (spots.refunded ?? 0) + (spots.cancelled ?? 0)],
          ]}
        />
        <Breakdown
          title="most bid-on listings"
          rows={
            marketplace.topListings.length
              ? marketplace.topListings.map((row) => [
                  <Link key={row.slug} href={listingHref(row.handle, row.slug)} className="hover:text-accent hover:underline">
                    {row.title}
                  </Link>,
                  `${row.bids} · ${formatUsd(row.topBid)}`,
                ])
              : [["no bids yet", ""]]
          }
        />
      </Grid>
    </div>
  );
}

function UsersTab({ data }: { data: AdminMetrics }) {
  const { users, marketplace } = data;
  const { funnel } = users;
  const step = (label: string, value: number) => ({ label, value, display: String(value), hint: `${pct(funnel.signedUp ? value / funnel.signedUp : null)} of sign-ups` });
  const intent = (label: string, value = 0) => ({ label, value, display: String(value) });
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Tile label="users" value={String(users.total)} detail={`${users.newLast7} new in 7 days`} />
        <Tile label="finished onboarding" value={String(users.onboarded)} detail={`${pct(users.total ? users.onboarded / users.total : null)} of users`} />
        <Tile label="active in 7 days" value={String(users.activeLast7)} detail="made an on-chain action" />
        <Tile label="repeat sponsors" value={String(users.repeatSponsors)} detail="bought 2 or more spots" />
      </Grid>
      <Grid cols={3}>
        <HBars
          title="sign-up funnel"
          rows={[
            step("signed up", funnel.signedUp),
            step("verified email", funnel.emailVerified),
            step("finished onboarding", funnel.onboarded),
            step("submitted a listing", funnel.listed),
            step("bought a spot", funnel.bought),
          ]}
        />
        <DailyBars compact title="sign-ups, 30 days" total={String(total(data, (day) => day.signups))} points={daily(data, (day) => day.signups, (n) => plural(n, "sign-up"))} />
        <HBars
          title="what they came for"
          rows={[intent("sell ad space", users.byIntent.sell), intent("sponsor", users.byIntent.sponsor), intent("both", users.byIntent.both), intent("just browsing", users.byIntent.browse)]}
        />
      </Grid>
      <Grid cols={2}>
        <Breakdown
          title="top creators by earnings"
          rows={
            marketplace.topCreators.length
              ? marketplace.topCreators.map((row) => [profileLink(row.handle), `${formatUsd(row.earned)} · ${plural(row.spots, "spot")}`])
              : [["no payouts yet", ""]]
          }
        />
        <Breakdown
          title="top sponsors by spend"
          rows={
            marketplace.topSponsors.length
              ? marketplace.topSponsors.map((row) => [profileLink(row.handle), `${formatUsd(row.spent)} · ${plural(row.spots, "spot")}`])
              : [["no purchases yet", ""]]
          }
        />
      </Grid>
    </div>
  );
}

function HealthTab({ data }: { data: AdminMetrics }) {
  const { health, money } = data;
  const queueSlow = health.reviewQueue.oldestHours !== null && health.reviewQueue.oldestHours > 24;
  return (
    <div className="flex flex-col gap-3">
      <Grid>
        <Tile
          label="open disputes"
          value={String(health.disputesByState.open ?? 0)}
          detail={
            <Link href="/review?tab=disputes" className="text-accent hover:underline">
              {health.disputes.waitingOnMultisig} waiting on the multisig
            </Link>
          }
        />
        <Tile label="dispute rate" value={pct(health.disputes.rate, 1)} detail={`of sold spots · closed in ${hours(health.disputes.hoursToClose)} on average`} />
        <Tile
          label="failed transactions"
          value={String(health.failedTxsLast7)}
          detail={
            <Link href="/review?tab=failed" className="text-accent hover:underline">
              7 days · {health.abandonedTxsLast7} abandoned, never signed
            </Link>
          }
          status={{ ok: health.failedTxsLast7 === 0, text: health.failedTxsLast7 === 0 ? "none on-chain" : "check the failed tab" }}
        />
        <Tile label="fee and rent payer" value={health.feePayerSol === null ? "unavailable" : `${health.feePayerSol.toFixed(3)} SOL`} detail="pays every fee and all rent" status={feePayerStatus(data)} />
        <Tile
          label="review queue"
          value={plural(health.reviewQueue.waiting, "listing")}
          detail={health.reviewQueue.oldestHours === null ? "nothing waiting" : `oldest waiting ${hours(health.reviewQueue.oldestHours)}`}
          status={queueSlow ? { ok: false, text: "over a day: review it" } : undefined}
        />
        <Tile
          label="overdue deliveries"
          value={String(health.overdueDeliveries.count)}
          detail={`${formatUsd(health.overdueDeliveries.amount)} past due with no proof`}
          status={{ ok: health.overdueDeliveries.count === 0, text: health.overdueDeliveries.count === 0 ? "all on time" : "sponsors can take refunds" }}
        />
        <Tile label="payouts ready" value={String(money.payoutsReady.count)} detail={`${formatUsd(money.payoutsReady.amount)} past the review window`} />
        <Tile
          label="escrow check"
          value={money.escrow.matches === null ? "unavailable" : money.escrow.matches ? "balanced" : "mismatch"}
          detail="database vs on-chain vaults"
          status={escrowStatus(data)}
        />
      </Grid>
      <Grid cols={3}>
        <DailyBars compact title="disputes opened, 30 days" total={String(total(data, (day) => day.disputes))} points={daily(data, (day) => day.disputes, (n) => plural(n, "dispute"))} />
        <DailyBars compact title="failed transactions, 30 days" total={String(total(data, (day) => day.failedTxs))} points={daily(data, (day) => day.failedTxs, (n) => `${n} failed`)} />
        <Breakdown
          title="dispute outcomes"
          rows={[
            ["decided (split or refund)", health.disputesByState.resolved ?? 0],
            ["withdrawn by the sponsor", health.disputesByState.withdrawn ?? 0],
            ["timed out, full refund", health.disputesByState.timed_out ?? 0],
          ]}
        />
      </Grid>
      <Breakdown
        title="transactions by type, 7 days"
        rows={
          health.txByOp.length
            ? health.txByOp.map((row) => [
                row.op.replaceAll("_", " "),
                `${row.confirmed} ok${row.failed ? ` · ${row.failed} failed` : ""}${row.abandoned ? ` · ${row.abandoned} unsigned` : ""}`,
              ])
            : [["no transactions", ""]]
        }
      />
    </div>
  );
}
