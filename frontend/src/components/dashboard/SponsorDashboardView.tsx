"use client";

import { useQuery } from "@tanstack/react-query";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, CircleSlash, Compass, ImageOff, RotateCcw, Scale, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { cx } from "@/lib/cx";
import { spotView } from "@/lib/spot-views";
import { isFinished, nextStepOf, outcomeOf, progressOf, PROGRESS_STEPS, spentOn, type SponsorSpot } from "@/lib/sponsor-spot";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { Stat } from "@/components/ui/Stat";
import { SpotStateBadge } from "@/components/ui/StateBadge";
import { DashboardHeader } from "./DashboardHeader";
import { NeedsYouList } from "./NeedsYouList";
import { UserLink } from "@/components/ui/UserLink";
import { userErrorMessage } from "@/lib/errors";

// The photo this spot sits on, with only this sponsor's sticker drawn (their logo when they have one).
function SpotThumb({ spot }: { spot: SponsorSpot }) {
  const photos = spot.listing.photos ?? [];
  const photo = photos[spotView(spot.layout, photos.length)];
  if (!photo) {
    return (
      <div className="flex aspect-[4/3] items-center justify-center rounded-card bg-ink/5 text-subtle">
        <ImageOff className="size-5" aria-hidden />
      </div>
    );
  }
  const logoUrl = spot.brand?.logoUrl;
  return (
    <SpotMockup
      photoUrl={photo.url}
      alt=""
      size="thumb"
      selectedId={spot.id}
      // Without a logo the sticker is drawn in the highlight colour ("open" + selected) rather than the muted taken style.
      spots={[{ id: spot.id, index: spot.index, label: spot.label, layout: spot.layout, state: logoUrl ? spot.state : "open", logoUrl }]}
    />
  );
}

function BrandRow({ brand }: { brand: SponsorSpot["brand"] }) {
  return (
    <div className="flex min-w-0 items-center gap-2 text-small">
      {brand?.logoUrl ? (
        <span className="relative size-5 shrink-0 overflow-hidden rounded-md border border-line bg-surface">
          <Image src={brand.logoUrl} alt="" fill sizes="20px" className="object-contain" />
        </span>
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-ink/5 text-caption font-semibold text-muted" aria-hidden>
          {(brand?.name ?? "?").slice(0, 1).toLowerCase()}
        </span>
      )}
      <span className="truncate font-medium">{brand?.name ?? "your brand"}</span>
    </div>
  );
}

function Progress({ spot }: { spot: SponsorSpot }) {
  const done = progressOf(spot);
  const disputed = spot.state === "disputed";
  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label={`${done} of ${PROGRESS_STEPS.length} steps done`}>
      {PROGRESS_STEPS.map((step, index) => {
        const complete = index < done;
        return (
          <li key={step} className="flex flex-col gap-1">
            <span
              className={cx("h-1 rounded-full", complete ? (disputed ? "bg-warning" : "bg-accent") : "bg-ink/10")}
              aria-hidden
            />
            <span className={cx("text-caption", complete ? "text-ink" : "text-subtle")}>{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

const OUTCOME_ICON: Record<string, LucideIcon> = {
  payout: CheckCircle2,
  refund: RotateCcw,
  timeout_refund: RotateCcw,
  dispute_split: Scale,
};

const toneText = { neutral: "text-ink", action: "text-accent", warning: "text-warning" } as const;
const outcomeText = { neutral: "text-muted", accent: "text-accent", success: "text-success", warning: "text-warning", danger: "text-danger" } as const;

function SpotCard({ spot }: { spot: SponsorSpot }) {
  const finished = isFinished(spot);
  const step = finished ? null : nextStepOf(spot);
  const outcome = finished ? outcomeOf(spot) : null;
  const spent = spentOn(spot);
  const amount = BigInt(spot.amount ?? 0);
  const OutcomeIcon = spot.settlement ? OUTCOME_ICON[spot.settlement.kind] : spot.state === "settled" ? CheckCircle2 : CircleSlash;
  return (
    <Link
      href={`/dashboard/spots/${spot.id}`}
      className="flex flex-col gap-3 rounded-card border border-line bg-surface p-3 shadow-card transition-colors hover:border-line-strong"
    >
      <div className="flex gap-4">
        <div className="w-28 shrink-0 sm:w-36">
          <SpotThumb spot={spot} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5 py-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-2 text-body font-semibold">{spot.listing.title}</p>
            <SpotStateBadge state={spot.state} perspective="sponsor" />
          </div>
          <p className="truncate text-small text-muted">
            spot {spot.index + 1}
            {spot.label && <> · {spot.label}</>} · <UserLink handle={spot.listing.sellerHandle} nested />
          </p>
          <BrandRow brand={spot.brand} />
          <p className="mt-auto text-small text-muted">
            {finished ? (
              <>
                <Money value={spent} className="text-lead font-semibold text-ink" /> spent
                {spent !== amount && amount > 0n && (
                  <>
                    {" "}
                    of <Money value={amount} />
                  </>
                )}
              </>
            ) : (
              <>
                <Money value={amount} className="text-lead font-semibold text-ink" /> in escrow
              </>
            )}
          </p>
        </div>
      </div>
      {step && (
        <div className="flex flex-col gap-2.5 border-t border-line pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-small">
            <p className={cx("font-medium", toneText[step.tone])}>{step.text}</p>
            {step.countdown && <Countdown to={step.countdown.to} prefix={step.countdown.prefix} className="text-muted" />}
          </div>
          <Progress spot={spot} />
        </div>
      )}
      {outcome && (
        <p className={cx("flex items-center gap-2 border-t border-line pt-3 text-small font-medium", outcomeText[outcome.tone])}>
          <OutcomeIcon className="size-4 shrink-0" aria-hidden />
          {outcome.text}
        </p>
      )}
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
          description={userErrorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>try again</Button>}
        />
      ) : (
        <>
          <NeedsYouList items={query.data.needsYou} emptyText="you're all caught up." />
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card className="p-4">
              <Stat label="spent" value={<Money value={query.data.stats.spent} />} hint="net of refunds" />
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
                  <Link href="/browse" className={buttonClasses()}>
                    browse spaces
                  </Link>
                }
              />
            ) : (
              <SpotGroups spots={query.data.spots} />
            )}
          </section>
        </>
      )}
    </div>
  );
}

// Active spots first; finished ones (paid out, refunded, split in a dispute) stay as history, never removed.
function SpotGroups({ spots }: { spots: SponsorSpot[] }) {
  const active = spots.filter((spot) => !isFinished(spot));
  const history = spots.filter(isFinished);
  return (
    <div className="flex flex-col gap-6">
      {active.length > 0 ? (
        <div className="grid gap-3 lg:grid-cols-2">
          {active.map((spot) => (
            <SpotCard key={spot.id} spot={spot} />
          ))}
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-line px-4 py-6 text-center text-small text-muted">
          nothing active right now.{" "}
          <Link href="/browse" className="font-medium text-accent hover:underline">
            browse spaces
          </Link>
        </p>
      )}
      {history.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-body font-semibold text-muted">
            history <span className="font-normal">({history.length})</span>
          </h3>
          <div className="grid gap-3 lg:grid-cols-2">
            {history.map((spot) => (
              <SpotCard key={spot.id} spot={spot} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
