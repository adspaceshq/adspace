"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, Plus, Store } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { CreatorDashboard, ListingState } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { spotsOnView } from "@/lib/spot-views";
import { Stat } from "@/components/ui/Stat";
import { ListingStateBadge } from "@/components/ui/StateBadge";
import { ActivityFeed } from "./ActivityFeed";
import { DashboardHeader } from "./DashboardHeader";
import { EarningsChart } from "./EarningsChart";
import { NeedsYouList } from "./NeedsYouList";

type CreatorListing = CreatorDashboard["listings"][number];

const IN_PROGRESS: ListingState[] = ["draft", "in_review", "changes_requested", "approved", "publishing"];

const listingLink = (listing: CreatorListing) =>
  listing.state === "draft" || listing.state === "changes_requested" ? `/sell/drafts/${listing.id}` : `/sell/listings/${listing.id}`;

function ListingTile({ listing }: { listing: CreatorListing }) {
  const cover = listing.photos?.[0]?.url;
  const escrow = listing.spots
    .filter((spot) => ["funded", "delivered", "disputed"].includes(spot.state))
    .reduce((sum, spot) => sum + BigInt(spot.amount ?? 0), 0n);
  return (
    <Link href={listingLink(listing)} className="flex gap-4 rounded-card border border-line bg-surface p-3 shadow-card transition-colors hover:border-line-strong">
      <div className="w-28 shrink-0 sm:w-36">
        {cover ? (
          <SpotMockup
            photoUrl={cover}
            alt=""
            size="thumb"
            spots={spotsOnView(listing.spots, 0, listing.photos?.length ?? 0).map((spot) => ({ id: spot.id, index: spot.index, layout: spot.layout, state: spot.state }))}
          />
        ) : (
          <div className="aspect-[4/3] rounded-card bg-ink/5" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-body font-semibold">{listing.title}</p>
          <ListingStateBadge state={listing.state} />
        </div>
        <p className="text-small text-muted">
          {listing.soldCount} of {listing.spotCount} sold
          {escrow > 0n && (
            <>
              {" · "}
              <Money value={escrow} /> in escrow
            </>
          )}
        </p>
        {listing.state === "published" && <Countdown to={listing.deadline} prefix="closes in" className="text-small" />}
        {listing.reviewNote && (listing.state === "changes_requested" || listing.state === "rejected") && (
          <p className="line-clamp-2 rounded-control bg-warning-soft px-2 py-1 text-small text-ink">&ldquo;{listing.reviewNote}&rdquo;</p>
        )}
      </div>
    </Link>
  );
}

function ListingGroup({ title, listings }: { title: string; listings: CreatorListing[] }) {
  if (listings.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-small font-medium uppercase tracking-wide text-subtle">{title}</h3>
      <div className="grid gap-3 lg:grid-cols-2">
        {listings.map((listing) => (
          <ListingTile key={listing.id} listing={listing} />
        ))}
      </div>
    </div>
  );
}

export function CreatorDashboardView() {
  const query = useQuery({
    queryKey: queryKeys.creatorDashboard,
    queryFn: () => api.me.creatorDashboard(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader active="creator" />
      {query.isPending ? (
        <SkeletonGroup label="loading dashboard">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          </div>
        </SkeletonGroup>
      ) : query.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="couldn't load your dashboard"
          description={query.error.message}
          action={<Button onClick={() => void query.refetch()}>try again</Button>}
        />
      ) : (
        <>
          <NeedsYouList items={query.data.needsYou} emptyText="nothing needs you right now." />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Card className="p-4">
              <Stat label="earned" value={<Money value={query.data.stats.earned} />} hint="paid to your wallet" />
            </Card>
            <Card className="p-4">
              <Stat label="in escrow" value={<Money value={query.data.stats.pendingEscrow} />} hint="released after delivery" />
            </Card>
            <Card className="p-4">
              <Stat label="live listings" value={query.data.stats.liveListings} />
            </Card>
            <Card className="p-4">
              <Stat label="spots sold" value={query.data.stats.spotsSold} />
            </Card>
            <Card className="col-span-2 p-4 lg:col-span-1">
              <Stat
                label="on-time delivery"
                value={query.data.stats.onTimeRate === null ? "—" : `${Math.round(query.data.stats.onTimeRate * 100)}%`}
                hint={query.data.stats.onTimeRate === null ? "after your first delivery" : undefined}
              />
            </Card>
          </div>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <EarningsChart />
            <ActivityFeed />
          </div>
          <section aria-labelledby="your-listings" className="flex flex-col gap-5">
            <div className="flex items-center justify-between gap-3">
              <h2 id="your-listings" className="text-lead font-semibold">
                your listings
              </h2>
              <Link href="/sell" className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-1.5 text-small font-medium text-white hover:bg-ink-soft">
                <Plus className="size-4" aria-hidden /> new listing
              </Link>
            </div>
            {query.data.listings.length === 0 ? (
              <EmptyState
                icon={Store}
                title="list your first space"
                description="a laptop lid, a car door, a backpack. set your spots and prices; we review it within a day."
                action={
                  <Link href="/sell" className="rounded-control bg-ink px-4 py-2 text-body font-medium text-white hover:bg-ink-soft">
                    start listing
                  </Link>
                }
              />
            ) : (
              <>
                <ListingGroup title="live" listings={query.data.listings.filter((listing) => listing.state === "published")} />
                <ListingGroup title="in progress" listings={query.data.listings.filter((listing) => IN_PROGRESS.includes(listing.state))} />
                <ListingGroup title="past" listings={query.data.listings.filter((listing) => listing.state === "closed" || listing.state === "rejected")} />
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
