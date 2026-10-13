"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, BadgeCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { ReviewDecision, ReviewQueueItem } from "@/lib/api/types";
import { DEFAULT_FEES, feeFor, feePolicyError, type FeePolicy } from "@/lib/fees";
import { formatFollowers } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/Skeleton";
import { SpotPhotos } from "@/components/ui/SpotPhotos";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { UserLink } from "@/components/ui/UserLink";

const toLocal = (iso: string) => {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function ListingDecision({ listingId }: { listingId: string }) {
  const queue = useQuery({ queryKey: queryKeys.reviewQueue, queryFn: () => api.review.queue() });
  const status = useQuery({ queryKey: queryKeys.adminStatus, queryFn: () => api.admin.status() });
  if (queue.isPending) return <Skeleton className="h-96 w-full" />;
  const listing = queue.data?.find((item) => item.id === listingId);
  if (!listing) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="not in the review queue"
        description="it may already have been decided."
        action={
          <Link href="/review" className="text-body font-medium text-accent hover:underline">
            back to the queue
          </Link>
        }
      />
    );
  }
  return <DecisionForm listing={listing} floorBps={status.data?.feeBps ?? 250} />;
}

function DecisionForm({ listing, floorBps }: { listing: ReviewQueueItem; floorBps: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [fees, setFees] = useState<FeePolicy>(DEFAULT_FEES[listing.mode]);
  const [reviewHours, setReviewHours] = useState(String(Math.round(listing.reviewWindowSeconds / 3600)));
  const [delivery, setDelivery] = useState(toLocal(listing.deliveryDueAt));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();

  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) => api.review.decide(listing.id, decision),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueue }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewSummary }),
      ]);
      router.push("/review");
    },
    onError: (cause) => setError(cause.message),
  });

  const ownListing = session?.id === listing.sellerId;
  const policyError = feePolicyError(listing.mode, fees, floorBps);
  const sample = listing.spots[0] ? BigInt(listing.spots[0].price) : 0n;
  const sampleFee = feeFor(listing.mode, fees, sample, sample);
  const hotAuction = sample * 3n;
  const hotFee = feeFor(listing.mode, fees, sample, hotAuction);
  const setBps = (key: keyof FeePolicy, percent: string) => {
    const bps = Math.round(Number(percent) * 100);
    setFees((current) => (listing.mode === "fixed" ? { feeBps: bps, upliftFeeBps: 0, maxFeeBps: bps } : { ...current, [key]: bps }));
  };

  const approve = () => {
    const hours = Number(reviewHours);
    if (policyError) return setError(policyError);
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) return setError("review window must be 1-720 hours");
    setError(undefined);
    decide.mutate({ action: "approve", fees, reviewWindowSeconds: hours * 3600, deliveryDueAt: new Date(delivery).toISOString(), note });
  };
  const sendBack = (action: "request_changes" | "reject") => {
    if (!note.trim()) return setError("tell the creator why in the note");
    setError(undefined);
    decide.mutate({ action, note });
  };

  return (
    <div className="flex flex-col gap-6">
      <Link href="/review" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> queue
      </Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-5">
          <h1 className="text-title font-semibold">{listing.title}</h1>
          {listing.photos.length > 0 && (
            <SpotPhotos
              photos={listing.photos.map((photo) => ({ url: photo.url }))}
              alt={listing.title}
              spots={listing.spots.map((spot) => ({ id: spot.id, index: spot.index, layout: spot.layout, state: "open", price: spot.price, label: spot.label }))}
            />
          )}
          {listing.description && <p className="whitespace-pre-line text-body text-muted">{listing.description}</p>}
          <dl className="grid gap-3 text-body sm:grid-cols-3">
            <div>
              <dt className="text-small text-muted">mode</dt>
              <dd>{listing.mode === "auction" ? (listing.doubleUp ? "auction · double-up" : `auction · +${formatUsd(listing.minIncrement)}`) : "fixed price"}</dd>
            </div>
            <div>
              <dt className="text-small text-muted">spots</dt>
              <dd>
                {listing.spots.length} · <Money value={listing.spots.reduce((sum, spot) => sum + BigInt(spot.price), 0n)} /> total
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted">claims close</dt>
              <dd>{new Date(listing.deadline).toLocaleString()}</dd>
            </div>
          </dl>
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
          <div className="flex items-center gap-3 rounded-panel border border-line bg-surface p-4 shadow-card">
            <SellerAvatar seller={listing.seller} size={40} />
            <div className="min-w-0">
              <p className="flex items-center gap-1 font-semibold">
                {listing.seller.displayName}
                {listing.seller.verified && <BadgeCheck className="size-4 text-accent" aria-label="verified" />}
              </p>
              <p className="text-small text-muted">
                <UserLink handle={listing.seller.handle} />
                {listing.audience.followers ? ` · ${formatFollowers(listing.audience.followers)} followers` : ""}
              </p>
            </div>
          </div>

          {ownListing && (
            <div role="note" className="flex gap-3 rounded-panel border border-warning/40 bg-warning-soft p-4 text-small">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
              <p>
                <span className="font-semibold">this is your own listing.</span> another reviewer has to approve, reject or request changes. sign in with a
                different reviewer account to test the decision.
              </p>
            </div>
          )}
          <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card">
            <p className="text-body font-semibold">fees</p>
            <div className={listing.mode === "auction" ? "grid grid-cols-3 gap-2" : "grid grid-cols-1"}>
              <Input label={listing.mode === "auction" ? "base %" : "fee %"} inputMode="decimal" value={String(fees.feeBps / 100)} onChange={(event) => setBps("feeBps", event.target.value)} />
              {listing.mode === "auction" && (
                <>
                  <Input label="uplift %" inputMode="decimal" value={String(fees.upliftFeeBps / 100)} onChange={(event) => setBps("upliftFeeBps", event.target.value)} />
                  <Input label="cap %" inputMode="decimal" value={String(fees.maxFeeBps / 100)} onChange={(event) => setBps("maxFeeBps", event.target.value)} />
                </>
              )}
            </div>
            {policyError ? (
              <p className="text-small text-danger">{policyError}</p>
            ) : (
              <div className="flex flex-col gap-1 rounded-card bg-canvas p-3 text-small">
                <p>
                  on a {formatUsd(sample)} spot: seller gets <strong>{formatUsd(sample - sampleFee)}</strong>, platform earns {formatUsd(sampleFee)}
                </p>
                {listing.mode === "auction" && (
                  <p className="text-muted">
                    if bidding reaches {formatUsd(hotAuction)}: seller gets {formatUsd(hotAuction - hotFee)}, platform {formatUsd(hotFee)}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input label="deliver by" type="datetime-local" value={delivery} onChange={(event) => setDelivery(event.target.value)} />
              <Input label="review window (h)" inputMode="numeric" value={reviewHours} onChange={(event) => setReviewHours(event.target.value)} />
            </div>
            <Textarea label="note to the creator" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} hint="required to request changes or reject" />
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button onClick={approve} loading={decide.isPending && decide.variables?.action === "approve"} disabled={decide.isPending || ownListing}>
                approve
              </Button>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => sendBack("request_changes")} disabled={decide.isPending || ownListing}>
                  request changes
                </Button>
                <Button variant="danger" onClick={() => sendBack("reject")} disabled={decide.isPending || ownListing}>
                  reject
                </Button>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
