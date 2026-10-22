"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Compass, Plus, Store } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { NeedsYouItem } from "@/lib/api/types";
import { listingLink } from "@/lib/dashboard-links";
import { userErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useUsdcBalance } from "@/lib/use-balance";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { ListingStateBadge, SpotStateBadge } from "@/components/ui/StateBadge";
import { DashboardHeader } from "./DashboardHeader";
import { NeedsYouList } from "./NeedsYouList";

const PREVIEW = 4;
const LIVE_LISTING = new Set(["draft", "in_review", "changes_requested", "approved", "publishing", "published"]);
const ACTIVE_SPOT = new Set(["funded", "delivered", "disputed"]);

// Soonest due first; items without a date after them. One task can come from both sides only by key.
function mergeNeedsYou(creator: NeedsYouItem[], sponsor: NeedsYouItem[]): NeedsYouItem[] {
  const seen = new Set<string>();
  return [...creator, ...sponsor]
    .filter((item) => {
      const key = `${item.type}:${item.listingId}:${item.spotId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity));
}

// The signed-in start page: what needs you on either side, your numbers, and a short look at your
// listings and spots. The creator and sponsor tabs keep the full detail.
export function HomeView() {
  const { session } = useSession();
  const creator = useQuery({ queryKey: queryKeys.creatorDashboard, queryFn: () => api.me.creatorDashboard(), refetchInterval: 30_000, refetchIntervalInBackground: false });
  const sponsor = useQuery({ queryKey: queryKeys.sponsorDashboard, queryFn: () => api.me.sponsorDashboard(), refetchInterval: 30_000, refetchIntervalInBackground: false });
  const balance = useUsdcBalance(session?.walletAddress);

  const role = session?.onboarding?.accountType;
  const actions = (
    <>
      <Link href="/browse" className={buttonClasses("secondary", "sm")}>
        <Compass className="size-4" aria-hidden /> find space
      </Link>
      <Link href="/sell" className={buttonClasses("primary", "sm")}>
        <Plus className="size-4" aria-hidden /> list a space
      </Link>
    </>
  );

  if (creator.isPending || sponsor.isPending) {
    return (
      <div className="flex flex-col gap-8">
        <DashboardHeader active="home" actions={actions} />
        <SkeletonGroup label="loading your home">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-24 w-full" />
            <div className="grid gap-4 lg:grid-cols-2">
              <Skeleton className="h-56" />
              <Skeleton className="h-56" />
            </div>
          </div>
        </SkeletonGroup>
      </div>
    );
  }
  if (creator.isError || sponsor.isError) {
    return (
      <div className="flex flex-col gap-8">
        <DashboardHeader active="home" actions={actions} />
        <EmptyState
          icon={AlertTriangle}
          title="couldn't load your home"
          description={userErrorMessage(creator.error ?? sponsor.error)}
          action={
            <Button
              onClick={() => {
                void creator.refetch();
                void sponsor.refetch();
              }}
            >
              try again
            </Button>
          }
        />
      </div>
    );
  }

  const listings = creator.data.listings;
  const spots = sponsor.data.spots;
  const liveListings = listings.filter((listing) => LIVE_LISTING.has(listing.state));
  const activeSpots = spots.filter((spot) => ACTIVE_SPOT.has(spot.state));
  // Each side shows when the account chose it at setup, or already has something there.
  const showCreator = role !== "sponsor" || listings.length > 0;
  const showSponsor = role !== "creator" || spots.length > 0;
  const needsYou = mergeNeedsYou(creator.data.needsYou, sponsor.data.needsYou);

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader active="home" actions={actions} />
      <NeedsYouList items={needsYou} emptyText="nothing needs you right now." />

      <dl className="grid gap-px overflow-hidden rounded-card border border-line bg-line shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <Figure label="wallet balance" value={<Money value={balance.data ?? null} />} detail={<Link href="/wallet" className="text-accent hover:underline">open wallet</Link>} />
        {showCreator && <Figure label="earned as creator" value={<Money value={creator.data.stats.earned} />} detail={`${creator.data.stats.spotsSold} spots sold`} />}
        {showSponsor && <Figure label="spent as sponsor" value={<Money value={sponsor.data.stats.spent} />} detail={`${sponsor.data.stats.delivered} delivered`} />}
        <Figure
          label="in escrow"
          value={<Money value={(BigInt(creator.data.stats.pendingEscrow) + BigInt(sponsor.data.stats.inEscrow)).toString()} />}
          detail="held on-chain until delivery"
        />
      </dl>

      <div className="grid gap-6 lg:grid-cols-2">
        {showCreator && (
          <Preview
            title="your listings"
            count={liveListings.length}
            more={{ href: "/dashboard/creator", label: "all listings" }}
            empty={
              <EmptyState
                icon={Store}
                title="list your first space"
                description="a laptop lid, a car door, a backpack. we review it within a day."
                action={
                  <Link href="/sell" className={buttonClasses()}>
                    start listing
                  </Link>
                }
              />
            }
          >
            {liveListings.slice(0, PREVIEW).map((listing) => (
              <Row
                key={listing.id}
                href={listingLink(listing)}
                title={listing.title}
                meta={`${listing.soldCount} of ${listing.spotCount} sold`}
                badge={<ListingStateBadge state={listing.state} />}
              />
            ))}
          </Preview>
        )}
        {showSponsor && (
          <Preview
            title="your spots"
            count={activeSpots.length}
            more={{ href: "/dashboard/sponsor", label: "all spots" }}
            empty={
              <EmptyState
                icon={Compass}
                title="find your first spot"
                description="sponsor a laptop at a conference, a car across a city, or a bag through airports."
                action={
                  <Link href="/browse" className={buttonClasses()}>
                    browse spaces
                  </Link>
                }
              />
            }
          >
            {activeSpots.slice(0, PREVIEW).map((spot) => (
              <Row
                key={spot.id}
                href={`/dashboard/spots/${spot.id}`}
                title={spot.listing.title}
                meta={`spot ${spot.index + 1} · @${spot.listing.sellerHandle}`}
                badge={<SpotStateBadge state={spot.state} perspective="sponsor" />}
              />
            ))}
          </Preview>
        )}
      </div>
    </div>
  );
}

function Figure({ label, value, detail }: { label: string; value: React.ReactNode; detail?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface px-4 py-3">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="text-lead font-semibold tabular-nums">{value}</dd>
      {detail && <dd className="truncate text-caption text-muted">{detail}</dd>}
    </div>
  );
}

// A short list with a link to the full page; the empty state takes its place when there is nothing yet.
function Preview({
  title,
  count,
  more,
  empty,
  children,
}: {
  title: string;
  count: number;
  more: { href: string; label: string };
  empty: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lead font-semibold">
          {title} {count > 0 && <span className="text-body font-normal text-muted">({count} open)</span>}
        </h2>
        <Link href={more.href} className="inline-flex items-center gap-1 text-small font-medium text-accent hover:underline">
          {more.label} <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {count === 0 ? empty : <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface shadow-card">{children}</ul>}
    </section>
  );
}

function Row({ href, title, meta, badge }: { href: string; title: string; meta: string; badge: React.ReactNode }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-ink/5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium">{title}</span>
          <span className="block truncate text-small text-muted">{meta}</span>
        </span>
        {badge}
      </Link>
    </li>
  );
}
