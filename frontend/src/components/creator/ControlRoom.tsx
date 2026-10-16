"use client";

import { safeHref } from "@/lib/safe-href";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, FilePen, XCircle } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { OwnedListing, Spot } from "@/lib/api/types";
import { listingHref } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/use-now";
import { useTx } from "@/lib/use-tx";
import { cx } from "@/lib/cx";
import { feeFor, listingFeePolicy } from "@/lib/fees";
import { formatUsd } from "@/lib/money";
import { SUPPORT_EMAIL } from "@/components/legal/LegalPage";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Countdown } from "@/components/ui/Countdown";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotPhotos } from "@/components/ui/SpotPhotos";
import { ListingStateBadge, SpotStateBadge } from "@/components/ui/StateBadge";
import { TxStatus } from "@/components/ui/TxStatus";
import { PostFeed } from "@/components/market/PostFeed";
import { MessagesPanel } from "@/components/spot/MessagesPanel";
import { PostComposer } from "./PostComposer";
import { ProofPicker } from "./ProofPicker";
import { PublishPanel } from "./PublishPanel";
import { XHandleLink } from "@/components/ui/UserLink";
import { useToast } from "@/components/ToastProvider";
import { isNotFound, userErrorMessage } from "@/lib/errors";
import { proofWindow } from "@/lib/listing-rules";

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
  if (query.isError) {
    return isNotFound(query.error) ? (
      <EmptyState icon={AlertTriangle} title="listing not found" description="it may have been deleted, or it belongs to another account." />
    ) : (
      <EmptyState
        icon={AlertTriangle}
        title="couldn't load this listing"
        description={userErrorMessage(query.error)}
        action={
          <Button variant="secondary" onClick={() => void query.refetch()}>
            try again
          </Button>
        }
      />
    );
  }

  const listing = query.data;
  const live = listing.state === "published" || listing.state === "closed";
  const selected = listing.spots.find((spot) => spot.id === selectedId) ?? listing.spots.find((spot) => spot.buyerId) ?? listing.spots[0];
  const sold = listing.spots.filter((spot) => spot.buyerId);
  const escrow = listing.spots
    .filter((spot) => ["funded", "delivered", "disputed"].includes(spot.state))
    .reduce((sum, spot) => sum + BigInt(spot.amount ?? 0), 0n);
  const cover = listing.photos?.[0]?.url;
  const finished =
    listing.state === "published" &&
    now >= new Date(listing.deadline).getTime() &&
    listing.spots.every((spot) => ["settled", "refunded", "cancelled"].includes(spot.state));

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
      {(listing.state === "draft" || listing.state === "changes_requested" || listing.state === "rejected") && <NotLiveState listing={listing} />}
      {finished && (
        <p className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-3 text-body text-muted">
          <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden />
          every spot is finished. adspaces closes this listing; nothing else to do.
        </p>
      )}

      {live && (
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex min-w-0 flex-col gap-6">
            {cover && (
              <SpotPhotos
                photos={(listing.photos ?? []).map((photo) => ({ url: photo.url }))}
                alt={listing.title}
                selectedId={selected?.id}
                onSelect={selectSpot}
                spots={listing.spots.map((spot) => ({ id: spot.id, index: spot.index, layout: spot.layout, state: spot.state, price: spot.price, logoUrl: spot.brand?.logoUrl }))}
              />
            )}
            <SpotTable listing={listing} selectedId={selected?.id} onSelect={selectSpot} now={now} />
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

const linkButton = "inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-control px-4 text-body font-medium transition-colors";

// Drafts, sent-back and rejected listings have no live view: say where things stand and what to do next.
function NotLiveState({ listing }: { listing: OwnedListing }) {
  const note = listing.reviewNote && (
    <p className="rounded-control border border-line bg-canvas px-3 py-2 text-body">
      <span className="text-small text-muted">note from the reviewer: </span>&ldquo;{listing.reviewNote}&rdquo;
    </p>
  );
  if (listing.state === "rejected") {
    return (
      <section role="note" className="flex flex-col gap-3 rounded-panel border border-danger/30 bg-danger-soft/40 p-5">
        <div className="flex items-center gap-2">
          <XCircle className="size-5 text-danger" aria-hidden />
          <h2 className="text-lead font-semibold">not approved</h2>
        </div>
        <p className="text-body text-muted">the adspaces team didn&apos;t approve this listing, so it can&apos;t be edited or published.</p>
        {note}
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/sell" className={cx(linkButton, "bg-ink text-white hover:bg-ink-soft")}>
            start a new listing
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-body font-medium text-accent hover:underline">
            questions? contact support
          </a>
        </div>
      </section>
    );
  }
  const changes = listing.state === "changes_requested";
  return (
    <section role="note" className={cx("flex flex-col gap-3 rounded-panel border p-5", changes ? "border-warning/30 bg-warning-soft/60" : "border-line bg-surface")}>
      <div className="flex items-center gap-2">
        <FilePen className={cx("size-5", changes ? "text-warning" : "text-muted")} aria-hidden />
        <h2 className="text-lead font-semibold">{changes ? "the reviewer asked for changes" : "this listing is a draft"}</h2>
      </div>
      <p className="text-body text-muted">
        {changes ? "make the changes and submit it again. it goes back to the review queue." : "finish the details and submit it for review. sponsors can't see it yet."}
      </p>
      {note}
      <Link href={`/sell/drafts/${listing.id}`} className={cx(linkButton, "bg-ink text-white hover:bg-ink-soft")}>
        edit listing
      </Link>
    </section>
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
  if (spot.state === "funded" && proofWindow(listing, now) === "not_yet") return "paid · proof opens after artwork close";
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
  const [confirmRefund, setConfirmRefund] = useState(false);
  const refund = useTx(() => api.spots.refund(spot.id, true));
  const payout = useTx(() => api.spots.payout(spot.id));
  const toast = useToast();
  // On success the panel moves to the spot's next state and the inline status goes with it.
  const run = async (tx: { execute: () => Promise<unknown> }, success: string) => {
    if (await tx.execute()) {
      await refresh();
      toast.success(success);
    }
  };
  const proofStage = proofWindow(listing, now);
  const canSubmitProof = spot.state === "funded" && proofStage === "open";
  const payable = spot.state === "delivered" && now >= reviewEnds(listing);
  // Refunding the leader of a live auction would end their bid with no way back in, so it waits for the close.
  const liveAuction = listing.mode === "auction" && now < new Date(listing.deadline).getTime();
  const policy = listingFeePolicy(listing);
  const gross = spot.amount ? BigInt(spot.amount) : 0n;
  const fee = policy ? feeFor(listing.mode, policy, BigInt(spot.price), gross) : null;
  const sponsorName = spot.brand?.name ?? "the sponsor";

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

      {spot.state === "open" && listing.state === "published" && <p className="text-small text-muted">not sold yet.</p>}
      {spot.state === "funded" && (
        <>
          {canSubmitProof ? (
            <Button onClick={() => setProofOpen(true)}>submit proof of delivery</Button>
          ) : proofStage === "not_yet" ? (
            <p className="text-small text-muted">
              place the brand once the artwork is final. proof opens at {new Date(listing.artworkDueAt).toLocaleString()} (in{" "}
              <Countdown to={listing.artworkDueAt} className="font-medium text-ink" />).
            </p>
          ) : (
            <p className="text-small text-danger">the delivery deadline passed without proof. the sponsor can now take a refund.</p>
          )}
          {canSubmitProof && (
            <p className="text-small text-muted">
              due in <Countdown to={listing.deliveryDueAt} className="font-medium text-ink" />. post an update with the brand in place, then tag it as proof.
            </p>
          )}
          {!liveAuction && (
            <Button variant="ghost" onClick={() => setConfirmRefund(true)} loading={refund.busy}>
              refund the sponsor
            </Button>
          )}
          <TxStatus state={refund.state} action="refund" onRetry={refund.retry} />
          <ConfirmModal
            open={confirmRefund}
            onClose={() => setConfirmRefund(false)}
            onConfirm={() => void run(refund, `refunded ${sponsorName}`)}
            title={`refund ${sponsorName}?`}
            description={`${formatUsd(gross)} goes back to ${sponsorName} from escrow and this sale is cancelled. the spot can't be sold again and this can't be undone.`}
            confirmLabel={`refund ${formatUsd(gross)}`}
            cancelLabel="keep the sale"
          />
        </>
      )}
      {spot.state === "delivered" && (
        <>
          {payable ? (
            <Button onClick={() => void run(payout, "payout sent to your wallet")} loading={payout.busy}>
              {fee !== null ? (
                <>
                  get paid <Money value={gross - fee} />
                  <span className="font-normal opacity-70">(after {formatUsd(fee)} fee)</span>
                </>
              ) : (
                <>
                  get paid <Money value={spot.amount} />
                </>
              )}
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
