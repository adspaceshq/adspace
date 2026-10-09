"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, Compass } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SponsorDashboard } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { Stat } from "@/components/ui/Stat";
import { SpotStateBadge } from "@/components/ui/StateBadge";
import { DashboardHeader } from "./DashboardHeader";
import { NeedsYouList } from "./NeedsYouList";

type SponsorSpot = SponsorDashboard["spots"][number];

function nextMoment(spot: SponsorSpot): { prefix: string; to: string } | null {
  if (spot.state === "funded") return { prefix: "delivery due in", to: spot.listing.deliveryDueAt };
  if (spot.state === "delivered" && spot.reviewUntil) return { prefix: "review closes in", to: spot.reviewUntil };
  return null;
}

function SpotCard({ spot }: { spot: SponsorSpot }) {
  const moment = nextMoment(spot);
  return (
    <Link
      href={`/dashboard/spots/${spot.id}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4 shadow-card transition-colors hover:border-line-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-body font-semibold">{spot.listing.title}</p>
          <p className="truncate text-small text-muted">
            spot {spot.index + 1} · @{spot.listing.sellerHandle}
          </p>
        </div>
        <SpotStateBadge state={spot.state} perspective="sponsor" />
      </div>
      <div className="flex items-end justify-between gap-3 text-small">
        <div>
          <p className="text-muted">{spot.brand?.name ?? "your brand"}</p>
          <p className="text-lead font-semibold">
            <Money value={spot.amount} />
          </p>
        </div>
        {moment && <Countdown to={moment.to} prefix={moment.prefix} className="text-right font-medium" />}
      </div>
    </Link>
  );
}

export function SponsorDashboardView() {
  const query = useQuery({
    queryKey: queryKeys.sponsorDashboard,
    queryFn: () => api.me.sponsorDashboard(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  return (
    <div className="flex flex-col gap-8">
      <DashboardHeader active="sponsor" />
      {query.isPending ? (
        <SkeletonGroup label="loading dashboard">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-28 w-full" />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
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
          <NeedsYouList items={query.data.needsYou} emptyText="you're all caught up." />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <Stat label="spent" value={<Money value={query.data.stats.spent} />} hint="delivered campaigns" />
            </Card>
            <Card className="p-4">
              <Stat label="in escrow" value={<Money value={query.data.stats.inEscrow} />} hint="held until delivery" />
            </Card>
            <Card className="p-4">
              <Stat label="active spots" value={query.data.stats.active} />
            </Card>
            <Card className="p-4">
              <Stat label="delivered" value={query.data.stats.delivered} />
            </Card>
          </div>
          <section aria-labelledby="your-spots" className="flex flex-col gap-3">
            <h2 id="your-spots" className="text-lead font-semibold">
              your spots
            </h2>
            {query.data.spots.length === 0 ? (
              <EmptyState
                icon={Compass}
                title="find your first spot"
                description="sponsor a laptop at a conference, a car across a city, or a bag through airports."
                action={
                  <Link href="/browse" className="rounded-control bg-ink px-4 py-2 text-body font-medium text-white hover:bg-ink-soft">
                    browse spaces
                  </Link>
                }
              />
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {query.data.spots.map((spot) => (
                  <SpotCard key={spot.id} spot={spot} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
