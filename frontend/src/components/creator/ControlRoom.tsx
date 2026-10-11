"use client";

import { safeHref } from "@/lib/safe-href";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { OwnedListing, Spot } from "@/lib/api/types";
import { listingHref } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/use-now";
import { useTx } from "@/lib/use-tx";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { ListingStateBadge, SpotStateBadge } from "@/components/ui/StateBadge";
import { TxStatus } from "@/components/ui/TxStatus";
import { PostFeed } from "@/components/market/PostFeed";
import { MessagesPanel } from "@/components/spot/MessagesPanel";
import { PostComposer } from "./PostComposer";
import { ProofPicker } from "./ProofPicker";
import { PublishPanel } from "./PublishPanel";
import { XHandleLink } from "@/components/ui/UserLink";

const TERMINAL = ["settled", "refunded", "cancelled"];
const reviewEnds = (listing: OwnedListing) => new Date(listing.deliveryDueAt).getTime() + listing.reviewWindowSeconds * 1000;

export function ControlRoom({ listingId }: { listingId: string }) {
  const params = useSearchParams();
  const now = useNow(15_000);
  const queryKey = ["me", "listing", listingId];
  const query = useQuery({ queryKey, queryFn: () => api.me.listing(listingId), refetchInterval: 30_000 });
  const [selectedId, setSelectedId] = useState<string | null>(params.get("spot"));
  const [panel, setPanel] = useState<"spot" | "updates">(params.get("tab") === "updates" ? "updates" : "spot");
  // Picking a spot on the photo or table brings its panel forward.
  const selectSpot = (id: string) => {
    setSelectedId(id);
    setPanel("spot");
  };

  if (query.isPending) {
    return (
      <SkeletonGroup label="loading listing">
        <Skeleton className="h-96 w-full" />
      </SkeletonGroup>
    );
  }
  if (query.isError) return <EmptyState icon={AlertTriangle} title="listing not found" description={query.error.message} />;

  const listing = query.data;
  const live = listing.state === "published" || listing.state === "closed";
  const selected = listing.spots.find((spot) => spot.id === selectedId) ?? listing.spots.find((spot) => spot.buyerId) ?? listing.spots[0];
  const sold = listing.spots.filter((spot) => spot.buyerId);
  const escrow = listing.spots
    .filter((spot) => ["funded", "delivered", "disputed"].includes(spot.state))
    .reduce((sum, spot) => sum + BigInt(spot.amount ?? 0), 0n);
  const cover = listing.photos?.[0]?.url;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/creator" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> your listings
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ListingStateBadge state={listing.state} />
            {listing.state === "published" && <Countdown to={listing.deadline} prefix="closes in" className="text-small" />}
          </div>
          <h1 className="text-title font-semibold sm:text-display">{listing.title}</h1>
          {live && (
            <p className="text-body text-muted">
              {sold.length} of {listing.spots.length} sold · <Money value={escrow} /> in escrow
            </p>
          )}
        </div>
        {live && (
          <ViewPublicLink slug={listing.slug} />
        )}
      </div>

      {(listing.state === "approved" || listing.state === "publishing") && <PublishPanel listing={listing} />}
      {listing.state === "in_review" && (
        <p className="rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">in review. the adspaces team usually responds within a day.</p>
      )}

      {live && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            {cover && (
              <SpotMockup
                photoUrl={cover}
                alt={listing.title}
                selectedId={selected?.id}
                onSelect={selectSpot}
                spots={listing.spots.map((spot) => ({ id: spot.id, index: spot.index, layout: spot.layout, state: spot.state, price: spot.price, logoUrl: spot.brand?.logoUrl }))}
              />
            )}
            <SpotTable listing={listing} selectedId={selected?.id} onSelect={selectSpot} now={now} />
            <CloseListing listing={listing} now={now} />
          </div>
          {/* Two tabs instead of one tall stack, so the page doesn't keep growing; pinned while the left side scrolls. */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-9.5rem)] lg:self-start lg:overflow-y-auto lg:pb-4 no-scrollbar">
            <div role="tablist" aria-label="listing panels" className="flex gap-1 rounded-control bg-ink/5 p-1 text-small">
              {(
                [
                  ["spot", selected ? `spot ${selected.index + 1}` : "spot"],
                  ["updates", "updates & proof"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={panel === id}
                  onClick={() => setPanel(id)}
                  className={cx("flex-1 cursor-pointer rounded-[calc(var(--radius-control)-2px)] px-3 py-1.5 font-medium transition-colors", panel === id ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
                >
                  {label}
                </button>
              ))}
            </div>
            {panel === "spot" ? (
              selected && <SpotPanel listing={listing} spot={selected} now={now} />
            ) : (
              <>
                <PostComposer listingId={listing.id} />
                <PostFeed listingId={listing.id} spots={listing.spots} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ViewPublicLink({ slug }: { slug: string }) {
  const { session } = useSession();
  if (!session) return null;
  return (
    <Link href={listingHref(session.handle, slug)} className="inline-flex items-center gap-1.5 self-start rounded-control border border-line bg-surface px-3 py-2 text-small font-medium hover:border-line-strong">
      view public page <ExternalLink className="size-3.5" aria-hidden />
    </Link>
  );
}

function spotNote(listing: OwnedListing, spot: Spot, now: number) {
  if (spot.state === "funded" && now < new Date(listing.deadline).getTime()) return "paid · deliver after claims close";
  if (spot.state === "funded") return "paid · proof due";
  if (spot.state === "delivered" && now < reviewEnds(listing)) return "delivered · sponsor reviewing";
  if (spot.state === "delivered") return "ready to get paid";
  return null;
}

function SpotTable({ listing, selectedId, onSelect, now }: { listing: OwnedListing; selectedId?: string; onSelect: (id: string) => void; now: number }) {
  return (
    <section aria-labelledby="spots" className="flex flex-col gap-3">
      <h2 id="spots" className="text-lead font-semibold">
        spots
      </h2>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {listing.spots.map((spot) => (
          <li key={spot.id}>
            <button
              type="button"
              onClick={() => onSelect(spot.id)}
              aria-pressed={spot.id === selectedId}
              className={cx("flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left", spot.id === selectedId ? "bg-accent-soft" : "hover:bg-canvas")}
            >
              <span className="flex size-8 shrink-0 items-center justify-center rounded-control bg-ink/5 font-mono text-small font-semibold">{spot.index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{spot.brand?.name ?? (spot.label || "unsold")}</span>
                <span className="block truncate text-small text-muted">{spotNote(listing, spot, now) ?? (spot.label || " ")}</span>
              </span>
              <Money value={spot.amount ?? spot.price} className="text-small font-medium" />
              <SpotStateBadge state={spot.state} perspective="creator" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useRefresh(listingId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["me", "listing", listingId] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard }),
    ]);
}

function SpotPanel({ listing, spot, now }: { listing: OwnedListing; spot: Spot; now: number }) {
  const refresh = useRefresh(listing.id);
  const [proofOpen, setProofOpen] = useState(false);
  const close = useTx(() => api.spots.close(spot.id));
  const refund = useTx(() => api.spots.refund(spot.id, true));
  const payout = useTx(() => api.spots.payout(spot.id));
  const run = async (tx: { execute: () => Promise<unknown> }) => {
    if (await tx.execute()) await refresh();
  };
  const proofWindow = spot.state === "funded" && now >= new Date(listing.deadline).getTime() && now < new Date(listing.deliveryDueAt).getTime();
  const payable = spot.state === "delivered" && now >= reviewEnds(listing);

  return (
    <section aria-labelledby="spot-panel" className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <h2 id="spot-panel" className="text-lead font-semibold">
          spot {spot.index + 1}
        </h2>
        <SpotStateBadge state={spot.state} perspective="creator" />
      </div>

      {spot.brand && (
        <div className="flex flex-col gap-1 rounded-card bg-canvas p-3 text-small">
          <span className="text-muted">sponsor brand</span>
          <span className="text-body font-semibold">{spot.brand.name}</span>
          {spot.brand.handle && <XHandleLink handle={spot.brand.handle} className="text-muted" />}
          {spot.brand.link && (
            <a href={safeHref(spot.brand.link)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
              {spot.brand.link} <ExternalLink className="size-3" aria-hidden />
            </a>
          )}
          {spot.brand.logoUrl && (
            <a href={spot.brand.logoUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
              download logo
            </a>
          )}
        </div>
      )}

      {spot.state === "open" && listing.state === "published" && (
        <>
          <p className="text-small text-muted">not sold yet. you can take it off sale; its rent comes back to you.</p>
          <Button variant="secondary" onClick={() => void run(close)} loading={close.busy}>
            close this spot
          </Button>
          <TxStatus state={close.state} action="close spot" onRetry={close.retry} />
        </>
      )}
      {spot.state === "funded" && (
        <>
          {proofWindow ? (
            <Button onClick={() => setProofOpen(true)}>submit proof of delivery</Button>
          ) : now < new Date(listing.deadline).getTime() ? (
            <p className="text-small text-muted">
              place the brand after claims close. proof opens in <Countdown to={listing.deadline} className="font-medium text-ink" />.
            </p>
          ) : (
            <p className="text-small text-danger">the delivery deadline passed without proof. the sponsor can now take a refund.</p>
          )}
          {proofWindow && (
            <p className="text-small text-muted">
              due in <Countdown to={listing.deliveryDueAt} className="font-medium text-ink" />. post an update with the brand in place, then tag it as proof.
            </p>
          )}
          <Button variant="ghost" onClick={() => void run(refund)} loading={refund.busy}>
            refund the sponsor
          </Button>
          <TxStatus state={refund.state} action="refund" onRetry={refund.retry} />
        </>
      )}
      {spot.state === "delivered" && (
        <>
          {payable ? (
            <Button onClick={() => void run(payout)} loading={payout.busy}>
              get paid <Money value={spot.amount} />
            </Button>
          ) : (
            <p className="text-small text-muted">
              proof submitted. you can be paid in <Countdown to={new Date(reviewEnds(listing)).toISOString()} className="font-medium text-ink" /> unless the sponsor disputes.
            </p>
          )}
          <TxStatus state={payout.state} action="payout" onRetry={payout.retry} />
        </>
      )}
      {spot.state === "disputed" && (
        <p className="rounded-control bg-warning-soft px-3 py-2 text-small text-ink">
          the sponsor opened a dispute. the adspaces team is reviewing your proof and their reason; reply in messages below.
        </p>
      )}
      {(spot.state === "settled" || spot.state === "refunded") && (
        <p className="text-small text-muted">{spot.state === "settled" ? "complete. payout sent to your wallet." : "refunded to the sponsor."}</p>
      )}

      {spot.buyerId && <MessagesPanel spotId={spot.id} counterpart={spot.brand?.name ?? "the sponsor"} />}
      {proofOpen && <ProofPicker listingId={listing.id} spotId={spot.id} spotIndex={spot.index} open={proofOpen} onClose={() => setProofOpen(false)} />}
    </section>
  );
}

function CloseListing({ listing, now }: { listing: OwnedListing; now: number }) {
  const refresh = useRefresh(listing.id);
  const tx = useTx(() => api.listings.close(listing.id));
  const ready = listing.state === "published" && now >= new Date(listing.deadline).getTime() && listing.spots.every((spot) => TERMINAL.includes(spot.state));
  if (!ready) return null;
  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex flex-col gap-1">
        <p className="text-body font-medium">every spot is finished</p>
        <p className="text-small text-muted">
          publishing put a small SOL deposit into this listing&apos;s on-chain accounts. closing returns that SOL to your wallet. it moves no USDC, and the
          listing page and its history stay visible.
        </p>
      </div>
      <Button variant="secondary" className="self-start" onClick={async () => (await tx.execute()) && (await refresh())} loading={tx.busy}>
        close listing and reclaim SOL
      </Button>
      <TxStatus state={tx.state} action="close listing" onRetry={tx.retry} />
    </div>
  );
}
