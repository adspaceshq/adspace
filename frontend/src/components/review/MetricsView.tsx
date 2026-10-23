"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { AdminMetrics, OpsRole, OpsWallet } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { cx } from "@/lib/cx";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { userErrorMessage } from "@/lib/errors";
import { listingHref, profileHref, SURFACE_LABELS } from "@/lib/listing-display";
import { Address } from "@/components/ui/Address";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { DailyBars, type DailyPoint } from "./DailyBars";
import { HBars } from "./HBars";

const TABS = ["overview", "money", "marketplace", "users", "health", "wallets"] as const;
type Tab = (typeof TABS)[number];

const usd = (value: string | null | undefined) => (value == null ? "unavailable" : formatUsd(value));
const pct = (value: number | null, digits = 0) => (value === null ? "n/a" : `${(value * 100).toFixed(digits)}%`);
const hours = (value: number | null) => (value === null ? "n/a" : value < 1 ? `${Math.max(1, Math.round(value * 60))} min` : value < 48 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} days`);
const sumOf = (record: Partial<Record<string, number>>) => Object.values(record).reduce<number>((total, value) => total + (value ?? 0), 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Every tab has the same shape on desktop: a stat strip, a row of charts, then a row of cards that
// stretches to the bottom edge, where each card scrolls on its own. The page itself never scrolls
// (AppShell fill). Phones stack everything and scroll the page as usual.
export function MetricsView() {
  const params = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "overview") as Tab;
  const query = useQuery({ queryKey: queryKeys.adminMetrics, queryFn: () => api.admin.metrics(), refetchInterval: 60_000 });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <Link href="/review" aria-label="back to the review queue" className="self-center text-muted hover:text-ink">
            <ArrowLeft className="size-5" aria-hidden />
          </Link>
          <h1 className="text-title font-semibold">metrics</h1>
          <p className="text-small text-muted">
            {ADSPACES_CLUSTER === "mainnet-beta" ? "real money" : "test money, includes seeded demo data"}
            {query.data && ` · updated ${new Date(query.data.generatedAt).toLocaleTimeString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NetworkSwitch />
          <Button variant="secondary" size="sm" onClick={() => void query.refetch()} loading={query.isFetching}>
            <RefreshCw className="size-4" aria-hidden /> refresh
          </Button>
        </div>
      </header>
      <Tabs active={`/review/metrics?tab=${tab}`} items={TABS.map((item) => ({ href: `/review/metrics?tab=${item}`, label: item }))} />
      {/* Only a fallback: on very short screens the rows can't fit and this area scrolls. */}
      <div className="flex min-h-0 flex-1 flex-col hover-scrollbar lg:overflow-y-auto">
        {tab === "wallets" ? (
          <WalletsTab />
        ) : query.isPending ? (
          <SkeletonGroup label="loading metrics">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-20 w-full" />
              <div className="grid gap-3 lg:grid-cols-3">
                {[0, 1, 2].map((key) => (
                  <Skeleton key={key} className="h-36" />
                ))}
              </div>
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

// Which network's numbers these are. One deployment serves one network today, so the other side is
// shown but disabled until mainnet launches; switching will then open the other deployment's metrics.
function NetworkSwitch() {
  const current = ADSPACES_CLUSTER === "mainnet-beta" ? "mainnet" : "devnet";
  return (
    <div role="radiogroup" aria-label="network" className="flex rounded-control border border-line bg-surface p-0.5 text-small">
      {(["devnet", "mainnet"] as const).map((network) => {
        const active = network === current;
        return (
          <button
            key={network}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={!active}
            title={active ? `showing ${network}` : `${network} metrics: coming soon, after launch`}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-control)-2px)] px-2.5 font-medium pointer-coarse:min-h-10",
              active ? "bg-ink text-white" : "cursor-not-allowed text-muted",
            )}
          >
            {network}
            {!active && <span className="rounded-full bg-ink/5 px-1.5 text-caption font-normal">soon</span>}
          </button>
        );
      })}
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

// ---------- layout ----------

// A tab: rows stacked, the last one takes the remaining height.
const Page = ({ children }: { children: React.ReactNode }) => <div className="flex flex-col gap-3 lg:min-h-0 lg:flex-1">{children}</div>;

const cols = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" } as const;

// A row of fixed-height panels (charts, short lists).
const Row = ({ n = 3, children }: { n?: keyof typeof cols; children: React.ReactNode }) => (
  <div className={cx("grid shrink-0 gap-3 sm:grid-cols-2", cols[n])}>{children}</div>
);

// The last row: stretches to the bottom edge; each card inside scrolls on its own.
const FillRow = ({ n = 4, children }: { n?: keyof typeof cols; children: React.ReactNode }) => (
  <div className={cx("grid gap-3 sm:grid-cols-2 lg:min-h-48 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]", cols[n])}>{children}</div>
);
// Class for a card inside a FillRow.
const scroll = "lg:h-full lg:min-h-0 lg:overflow-y-auto hover-scrollbar";

// Stats in one card, cells split by hairlines (the 1px gap shows the line colour behind them).
const StatStrip = ({ children }: { children: React.ReactNode }) => (
  <div className="grid shrink-0 gap-px overflow-hidden rounded-card border border-line bg-line shadow-card sm:grid-cols-2 lg:grid-cols-4">{children}</div>
);

type Status = { ok: boolean; text: string };

function Stat({ label, value, detail, status }: { label: string; value: string; detail?: React.ReactNode; status?: Status }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
      <span className="text-small text-muted">{label}</span>
      <span className="text-lead font-semibold tabular-nums">{value}</span>
      {detail && <span className="truncate text-caption text-muted">{detail}</span>}
      {status && (
        <span className={cx("inline-flex items-center gap-1 text-caption font-medium", status.ok ? "text-success" : "text-danger")}>
          {status.ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{status.text}</span>
        </span>
      )}
    </div>
  );
}

function List({ title, rows, className }: { title: string; rows: Array<[React.ReactNode, number | string]>; className?: string }) {
  return (
    <div className={cx("rounded-card border border-line bg-surface p-3 shadow-card", className)}>
      <h3 className="mb-1 text-small font-medium text-muted">{title}</h3>
      <dl className="flex flex-col divide-y divide-line">
        {rows.map(([label, value], index) => (
          <div key={index} className="flex items-center justify-between gap-3 py-1.5 text-small">
            <dt className="min-w-0 truncate">{label}</dt>
            <dd className="shrink-0 font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

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
    <Page>
      <StatStrip>
        <Stat label="settled sales" value={formatUsd(money.settledGross.all)} detail={`7 days ${formatUsd(money.settledGross.last7)}`} />
        <Stat label="platform fees" value={formatUsd(money.fees.all)} detail={`7 days ${formatUsd(money.fees.last7)}`} />
        <Stat label="in escrow now" value={formatUsd(money.escrow.amount)} detail={plural(money.escrow.spots, "spot")} status={escrowStatus(data)} />
        <Stat label="treasury (on-chain)" value={usd(money.treasury)} detail="fees in the multisig treasury" />
        <Stat label="spots sold" value={String(marketplace.spotsSold)} detail={`sell-through ${pct(marketplace.sellThrough)}`} />
        <Stat label="users" value={String(users.total)} detail={`${users.newLast7} new · ${users.activeLast7} active in 7 days`} />
        <Stat
          label="open disputes"
          value={String(health.disputesByState.open ?? 0)}
          detail={
            <Link href="/review?tab=disputes" className="text-accent hover:underline">
              dispute queue
            </Link>
          }
        />
        <Stat label="fee and rent payer" value={health.feePayerSol === null ? "unavailable" : `${health.feePayerSol.toFixed(2)} SOL`} status={feePayerStatus(data)} />
      </StatStrip>
      {/* The charts take the rest of the screen. */}
      <FillRow n={3}>
        <DailyBars fill title="settled sales, 30 days" total={totalUsd(data, (day) => day.settledGross)} points={dailyUsd(data, (day) => day.settledGross)} />
        <DailyBars fill title="spots sold, 30 days" total={String(total(data, (day) => day.sales))} points={daily(data, (day) => day.sales, (n) => plural(n, "sale"))} />
        <DailyBars fill title="sign-ups, 30 days" total={String(total(data, (day) => day.signups))} points={daily(data, (day) => day.signups, (n) => plural(n, "sign-up"))} />
      </FillRow>
    </Page>
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
    <Page>
      <StatStrip>
        <Stat label="settled sales" value={formatUsd(money.settledGross.all)} detail={`7 days ${formatUsd(money.settledGross.last7)} · 30 days ${formatUsd(money.settledGross.last30)}`} />
        <Stat
          label="platform fees"
          value={formatUsd(money.fees.all)}
          detail={`effective rate ${money.feeRateBps === null ? "n/a" : `${(money.feeRateBps / 100).toFixed(2)}%`} · 30 days ${formatUsd(money.fees.last30)}`}
        />
        <Stat label="in escrow now" value={formatUsd(money.escrow.amount)} detail={plural(money.escrow.spots, "spot")} status={escrowStatus(data)} />
        <Stat label="payouts ready" value={formatUsd(money.payoutsReady.amount)} detail={`${plural(money.payoutsReady.count, "spot")} past the review window`} />
      </StatStrip>
      <Row>
        <DailyBars compact title="settled sales, 30 days" total={totalUsd(data, (day) => day.settledGross)} points={dailyUsd(data, (day) => day.settledGross)} />
        <DailyBars compact title="platform fees, 30 days" total={totalUsd(data, (day) => day.fees)} points={dailyUsd(data, (day) => day.fees)} />
        <DailyBars compact title="wallet withdrawals, 30 days" total={totalUsd(data, (day) => day.withdrawn)} points={dailyUsd(data, (day) => day.withdrawn)} />
      </Row>
      <FillRow>
        <HBars className={scroll} title="escrow by stage" rows={[stage("paid, awaiting delivery", "funded"), stage("delivered, in review", "delivered"), stage("disputed", "disputed")]} />
        <HBars
          className={scroll}
          title="settled by pricing"
          rows={money.byMode.map((row) => ({
            label: row.mode === "auction" ? "auction" : "fixed price",
            value: amount(row.settled),
            display: formatUsd(row.settled),
            hint: `${plural(row.sold, "sale")} · fees ${formatUsd(row.fees)}`,
          }))}
        />
        <List
          className={scroll}
          title="where settled money went"
          rows={[
            ["to creators", formatUsd(money.creatorPayouts)],
            ["refunded to sponsors", formatUsd(money.refunds)],
            ["platform fees", formatUsd(money.fees.all)],
            ["payouts", money.settlementsByKind.payout ?? 0],
            ["dispute splits", money.settlementsByKind.dispute_split ?? 0],
            ["full refunds", (money.settlementsByKind.refund ?? 0) + (money.settlementsByKind.timeout_refund ?? 0)],
          ]}
        />
        <List
          className={scroll}
          title="treasury and withdrawals"
          rows={[
            ["treasury (on-chain)", usd(money.treasury)],
            ["withdrawn to wallets", formatUsd(money.withdrawals.amount)],
            ["withdrawn in 30 days", formatUsd(money.withdrawals.last30)],
            ["withdrawals confirmed", money.withdrawals.confirmed],
            ["withdrawals in flight", money.withdrawals.inFlight],
          ]}
        />
      </FillRow>
    </Page>
  );
}

function MarketplaceTab({ data }: { data: AdminMetrics }) {
  const { marketplace } = data;
  const spots = marketplace.spotsByState;
  const listings = marketplace.listingsByState;
  return (
    <Page>
      <StatStrip>
        <Stat label="spots sold" value={String(marketplace.spotsSold)} detail={`sell-through ${pct(marketplace.sellThrough)} of ${sumOf(spots)} spots`} />
        <Stat label="average sale" value={formatUsd(marketplace.averageSale)} detail={`${marketplace.spotsPerListing?.toFixed(1) ?? "n/a"} spots per listing`} />
        <Stat
          label="auctions"
          value={marketplace.auctionUplift === null ? "n/a" : `+${Math.round((marketplace.auctionUplift - 1) * 100)}%`}
          detail={`above the start · ${marketplace.averageBidsPerAuctionSpot.toFixed(1)} bids per spot`}
        />
        <Stat label="live to first sale" value={hours(marketplace.hoursToFirstSale)} detail={`review takes ${hours(marketplace.reviewHours)}`} />
      </StatStrip>
      <Row>
        <DailyBars compact title="new listings, 30 days" total={String(total(data, (day) => day.listings))} points={daily(data, (day) => day.listings, (n) => plural(n, "listing"))} />
        <DailyBars compact title="bids, 30 days" total={String(total(data, (day) => day.bids))} points={daily(data, (day) => day.bids, (n) => plural(n, "bid"))} />
        <DailyBars compact title="spots sold, 30 days" total={String(total(data, (day) => day.sales))} points={daily(data, (day) => day.sales, (n) => plural(n, "sale"))} />
      </Row>
      <FillRow>
        <HBars
          className={scroll}
          title="sales by surface"
          rows={[...marketplace.bySurface]
            .sort((a, b) => b.sold - a.sold)
            .map((row) => ({
              label: SURFACE_LABELS[row.surface] ?? row.surface,
              value: row.sold,
              display: String(row.sold),
              hint: `${plural(row.listings, "listing")} · ${formatUsd(row.settled)}`,
            }))}
        />
        <HBars
          className={scroll}
          title="sold spots by price"
          rows={marketplace.priceBuckets.map((row) => ({
            label: row.bucket,
            value: row.count,
            display: String(row.count),
            hint: pct(marketplace.spotsSold ? row.count / marketplace.spotsSold : null),
          }))}
        />
        <List
          className={scroll}
          title="listings and spots"
          rows={[
            ["listings in review", listings.in_review ?? 0],
            ["listings live", (listings.published ?? 0) + (listings.publishing ?? 0)],
            ["listings closed", listings.closed ?? 0],
            ["drafts", listings.draft ?? 0],
            ["rejected", listings.rejected ?? 0],
            ["spots open", spots.open ?? 0],
            ["spots paid", spots.funded ?? 0],
            ["spots delivered", spots.delivered ?? 0],
            ["spots disputed", spots.disputed ?? 0],
            ["spots settled", spots.settled ?? 0],
            ["refunded or cancelled", (spots.refunded ?? 0) + (spots.cancelled ?? 0)],
          ]}
        />
        <List
          className={scroll}
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
      </FillRow>
    </Page>
  );
}

function UsersTab({ data }: { data: AdminMetrics }) {
  const { users, marketplace } = data;
  const { funnel } = users;
  const step = (label: string, value: number) => ({ label, value, display: String(value), hint: `${pct(funnel.signedUp ? value / funnel.signedUp : null)} of sign-ups` });
  const intent = (label: string, value = 0) => ({ label, value, display: String(value) });
  return (
    <Page>
      <StatStrip>
        <Stat label="users" value={String(users.total)} detail={`${users.newLast7} new in 7 days`} />
        <Stat label="finished onboarding" value={String(users.onboarded)} detail={`${pct(users.total ? users.onboarded / users.total : null)} of users`} />
        <Stat label="active in 7 days" value={String(users.activeLast7)} detail="made an on-chain action" />
        <Stat label="repeat sponsors" value={String(users.repeatSponsors)} detail="bought 2 or more spots" />
      </StatStrip>
      <Row>
        <DailyBars compact title="sign-ups, 30 days" total={String(total(data, (day) => day.signups))} points={daily(data, (day) => day.signups, (n) => plural(n, "sign-up"))} />
        <DailyBars compact title="spots sold, 30 days" total={String(total(data, (day) => day.sales))} points={daily(data, (day) => day.sales, (n) => plural(n, "sale"))} />
        <DailyBars compact title="new listings, 30 days" total={String(total(data, (day) => day.listings))} points={daily(data, (day) => day.listings, (n) => plural(n, "listing"))} />
      </Row>
      <FillRow>
        <HBars
          className={scroll}
          title="sign-up funnel"
          rows={[
            step("signed up", funnel.signedUp),
            step("verified email", funnel.emailVerified),
            step("finished onboarding", funnel.onboarded),
            step("submitted a listing", funnel.listed),
            step("bought a spot", funnel.bought),
          ]}
        />
        <HBars
          className={scroll}
          title="what they came for"
          rows={[intent("sell ad space", users.byIntent.sell), intent("sponsor", users.byIntent.sponsor), intent("both", users.byIntent.both), intent("just browsing", users.byIntent.browse)]}
        />
        <List
          className={scroll}
          title="top creators by earnings"
          rows={
            marketplace.topCreators.length
              ? marketplace.topCreators.map((row) => [profileLink(row.handle), `${formatUsd(row.earned)} · ${row.spots}`])
              : [["no payouts yet", ""]]
          }
        />
        <List
          className={scroll}
          title="top sponsors by spend"
          rows={
            marketplace.topSponsors.length
              ? marketplace.topSponsors.map((row) => [profileLink(row.handle), `${formatUsd(row.spent)} · ${row.spots}`])
              : [["no purchases yet", ""]]
          }
        />
      </FillRow>
    </Page>
  );
}

const ROLE_LABELS: Record<OpsRole, string> = {
  fee_payer: "fee & rent payer",
  reviewer: "reviewer",
  proposer: "squads proposer",
  config_authority: "config authority",
  upgrade_authority: "upgrade authority",
  treasury: "treasury",
  guardian: "pause guardian",
  member: "multisig member",
};
// Rent one fully delivered 10-spot listing holds until it closes (listing, spots, vaults, proofs).
const LISTING_RENT_SOL = 0.055;
const sol = (value: number | null) => (value === null ? "unavailable" : `${value.toFixed(value < 1 ? 4 : 3)} SOL`);

function walletStatus(wallet: OpsWallet): Status | undefined {
  if (wallet.low === null || wallet.sol === null) return undefined;
  if (wallet.targetSol === 0) return { ok: true, text: "needs no SOL" };
  if (wallet.low) return { ok: false, text: `low: top up ${(wallet.targetSol - wallet.sol).toFixed(3)} SOL` };
  return { ok: true, text: "funded" };
}

// Every wallet the platform runs on, found on-chain, with its SOL against the level it should hold.
function WalletsTab() {
  const query = useQuery({ queryKey: queryKeys.adminWallets, queryFn: () => api.admin.wallets(), refetchInterval: 60_000 });
  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="couldn't read the wallets"
        description={userErrorMessage(query.error, "the RPC node may be slow. try again in a minute.")}
        action={<Button onClick={() => void query.refetch()}>try again</Button>}
      />
    );
  }
  const { wallets } = query.data;
  const payer = wallets.find((wallet) => wallet.roles.includes("fee_payer"));
  const treasury = wallets.find((wallet) => wallet.roles.includes("treasury"));
  const low = wallets.filter((wallet) => wallet.low);
  const totalSol = wallets.reduce((sum, wallet) => sum + (wallet.sol ?? 0), 0);
  const runway = payer?.sol == null ? null : Math.max(0, Math.floor((payer.sol - payer.minSol) / LISTING_RENT_SOL));
  return (
    <Page>
      <StatStrip>
        <Stat
          label="fee and rent payer"
          value={sol(payer?.sol ?? null)}
          detail={runway === null ? undefined : `room for about ${plural(runway, "more 10-spot listing")} before the alert`}
          status={payer ? walletStatus(payer) : undefined}
        />
        <Stat
          label="wallets low on SOL"
          value={String(low.length)}
          detail={`of ${plural(wallets.length, "wallet")}`}
          status={{ ok: low.length === 0, text: low.length === 0 ? "all above their minimum" : low.map((wallet) => ROLE_LABELS[wallet.roles[0]]).join(", ") }}
        />
        <Stat label="treasury" value={treasury?.usdc == null ? "unavailable" : formatUsd(treasury.usdc)} detail="fees collected, held by the multisig" />
        <Stat label="SOL across wallets" value={sol(totalSol)} detail="rent locked in listings is not included" />
      </StatStrip>
      <div className={cx("rounded-card border border-line bg-surface shadow-card lg:min-h-0 lg:flex-1", scroll)}>
        <table className="w-full text-left text-small">
          <thead className="sticky top-0 bg-surface text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-2 font-medium">wallet</th>
              <th className="px-4 py-2 text-right font-medium">balance</th>
              <th className="px-4 py-2 text-right font-medium">minimum</th>
              <th className="px-4 py-2 text-right font-medium">top up to</th>
              <th className="px-4 py-2 font-medium">status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {wallets.map((wallet) => {
              const status = walletStatus(wallet);
              return (
                <tr key={wallet.address}>
                  <td className="px-4 py-2.5">
                    <p className="font-medium">{wallet.roles.map((role) => ROLE_LABELS[role]).join(" · ")}</p>
                    <Address value={wallet.address} className="text-caption text-muted" />
                  </td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                    {sol(wallet.sol)}
                    {wallet.usdc != null && <span className="block text-caption font-normal text-muted">{formatUsd(wallet.usdc)}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{wallet.minSol ? sol(wallet.minSol) : "none"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted">{wallet.targetSol ? sol(wallet.targetSol) : "none"}</td>
                  <td className="px-4 py-2.5">
                    {status && (
                      <span className={cx("inline-flex items-center gap-1 text-caption font-medium", status.ok ? "text-success" : "text-danger")}>
                        {status.ok ? <CheckCircle2 className="size-3.5 shrink-0" aria-hidden /> : <AlertTriangle className="size-3.5 shrink-0" aria-hidden />}
                        {status.text}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="border-t border-line px-4 py-2 text-caption text-muted">
          minimum is the alert level; top up to the target. the fee payer pays rent for every listing, spot and proof (about{" "}
          {LISTING_RENT_SOL} SOL per 10-spot listing, returned when it closes). addresses are read from the chain, so a rotated key
          shows up here on its own.
        </p>
      </div>
    </Page>
  );
}

function HealthTab({ data }: { data: AdminMetrics }) {
  const { health, money } = data;
  const queueSlow = health.reviewQueue.oldestHours !== null && health.reviewQueue.oldestHours > 24;
  return (
    <Page>
      <StatStrip>
        <Stat
          label="open disputes"
          value={String(health.disputesByState.open ?? 0)}
          detail={
            <Link href="/review?tab=disputes" className="text-accent hover:underline">
              {health.disputes.waitingOnMultisig} waiting on the multisig
            </Link>
          }
        />
        <Stat label="dispute rate" value={pct(health.disputes.rate, 1)} detail={`of sold spots · closed in ${hours(health.disputes.hoursToClose)}`} />
        <Stat
          label="failed transactions"
          value={String(health.failedTxsLast7)}
          detail={`7 days · ${health.abandonedTxsLast7} never signed`}
          status={{ ok: health.failedTxsLast7 === 0, text: health.failedTxsLast7 === 0 ? "none on-chain" : "check the failed tab" }}
        />
        <Stat label="fee and rent payer" value={health.feePayerSol === null ? "unavailable" : `${health.feePayerSol.toFixed(3)} SOL`} status={feePayerStatus(data)} />
        <Stat
          label="review queue"
          value={plural(health.reviewQueue.waiting, "listing")}
          detail={health.reviewQueue.oldestHours === null ? "nothing waiting" : `oldest waiting ${hours(health.reviewQueue.oldestHours)}`}
          status={queueSlow ? { ok: false, text: "over a day: review it" } : undefined}
        />
        <Stat
          label="overdue deliveries"
          value={String(health.overdueDeliveries.count)}
          detail={`${formatUsd(health.overdueDeliveries.amount)} past due, no proof`}
          status={{ ok: health.overdueDeliveries.count === 0, text: health.overdueDeliveries.count === 0 ? "all on time" : "sponsors can refund" }}
        />
        <Stat label="payouts ready" value={String(money.payoutsReady.count)} detail={`${formatUsd(money.payoutsReady.amount)} past review`} />
        <Stat label="escrow check" value={money.escrow.matches === null ? "unavailable" : money.escrow.matches ? "balanced" : "mismatch"} status={escrowStatus(data)} />
      </StatStrip>
      <FillRow n={3}>
        <DailyBars fill title="disputes opened, 30 days" total={String(total(data, (day) => day.disputes))} points={daily(data, (day) => day.disputes, (n) => plural(n, "dispute"))} />
        <DailyBars fill title="failed transactions, 30 days" total={String(total(data, (day) => day.failedTxs))} points={daily(data, (day) => day.failedTxs, (n) => `${n} failed`)} />
        <List
          className={scroll}
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
      </FillRow>
    </Page>
  );
}
