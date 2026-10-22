"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, BadgeCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { ReviewDecision, ReviewListingDetail, SellerHistory } from "@/lib/api/types";
import { DEFAULT_FEES, HIGH_FEE_BPS, bpsToPercentText, effectiveMaxFeeBps, feeFor, feePolicyError, isPercentDraft, parsePercentToBps, type FeePolicy } from "@/lib/fees";
import { formatFollowers } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Input, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/Skeleton";
import { SpotPhotos } from "@/components/ui/SpotPhotos";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { UserLink } from "@/components/ui/UserLink";
import { isNotFound, userErrorMessage } from "@/lib/errors";
import { listingStateLabel } from "@/components/ui/StateBadge";
import { Badge } from "@/components/ui/Badge";
import { ADMIN_APPROVAL_AFTER_DAYS, adminApprovalMessage, beyondHorizon, MAX_DELIVERY_DAYS, needsAdminApproval } from "@/lib/listing-rules";
import { useNow } from "@/lib/use-now";
import { FormattedText } from "@/components/ui/FormattedText";

const toLocal = (iso: string) => {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function ListingDecision({ listingId }: { listingId: string }) {
  const query = useQuery({ queryKey: queryKeys.reviewListing(listingId), queryFn: () => api.review.listing(listingId) });
  const status = useQuery({ queryKey: queryKeys.adminStatus, queryFn: () => api.admin.status() });
  if (query.isPending) return <Skeleton className="h-96 w-full" />;
  const listing = query.data;
  if (!listing || listing.state !== "in_review") {
    const missing = query.isError && isNotFound(query.error);
    return (
      <EmptyState
        icon={AlertTriangle}
        title={listing ? `already decided: ${listingStateLabel(listing.state)}` : missing ? "listing not found" : "couldn't load this listing"}
        description={
          listing
            ? listing.reviewNote
              ? `review note: ${listing.reviewNote}`
              : "it's no longer waiting for review."
            : missing
              ? "check the link, or pick a listing from the queue."
              : userErrorMessage(query.error)
        }
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

function DecisionForm({ listing, floorBps }: { listing: ReviewListingDetail; floorBps: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  // Raw text per field so "2." survives while typing; parsed to basis points for checks and approve.
  const [feeText, setFeeText] = useState<Record<keyof FeePolicy, string>>(() => {
    const defaults = DEFAULT_FEES[listing.mode];
    return { feeBps: bpsToPercentText(defaults.feeBps), upliftFeeBps: bpsToPercentText(defaults.upliftFeeBps), maxFeeBps: bpsToPercentText(defaults.maxFeeBps) };
  });
  const [confirm, setConfirm] = useState<"high_fee" | "reject" | null>(null);
  const [reviewHours, setReviewHours] = useState(String(Math.round(listing.reviewWindowSeconds / 3600)));
  const [delivery, setDelivery] = useState(toLocal(listing.deliveryDueAt));
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const now = useNow(60_000);

  const decide = useMutation({
    mutationFn: (decision: ReviewDecision) => api.review.decide(listing.id, decision),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewQueue }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewSummary }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewListing(listing.id) }),
      ]);
      router.push("/review");
    },
    onError: (cause) => setError(userErrorMessage(cause)),
  });

  const ownListing = session?.id === listing.sellerId;
  // Delivery more than N days out (the date in the form, which the reviewer may change) needs an admin.
  const approvalAfterDays = listing.adminApprovalAfterDays ?? ADMIN_APPROVAL_AFTER_DAYS;
  const adminOnly = needsAdminApproval(delivery, now, approvalAfterDays);
  const deliveryTooFar = beyondHorizon(delivery, now);
  const blockedForReviewer = adminOnly && !session?.isAdmin;
  const auction = listing.mode === "auction";
  const parsed = {
    feeBps: parsePercentToBps(feeText.feeBps),
    upliftFeeBps: auction ? parsePercentToBps(feeText.upliftFeeBps) : 0,
    maxFeeBps: auction ? parsePercentToBps(feeText.maxFeeBps) : parsePercentToBps(feeText.feeBps),
  };
  const fieldError = (key: keyof FeePolicy) => (parsed[key] === null ? "enter a % like 2.5 (0-100, up to 2 decimals)" : undefined);
  const fees: FeePolicy | null =
    parsed.feeBps !== null && parsed.upliftFeeBps !== null && parsed.maxFeeBps !== null
      ? { feeBps: parsed.feeBps, upliftFeeBps: parsed.upliftFeeBps, maxFeeBps: parsed.maxFeeBps }
      : null;
  const policyError = fees ? feePolicyError(listing.mode, fees, floorBps) : "fix the fee fields";
  const highFee = fees !== null && effectiveMaxFeeBps(fees) > HIGH_FEE_BPS;
  const sample = listing.spots[0] ? BigInt(listing.spots[0].price) : 0n;
  const hotAuction = sample * 3n;
  const hotFee = fees ? feeFor(listing.mode, fees, sample, hotAuction) : 0n;
  const setPercent = (key: keyof FeePolicy, text: string) => {
    if (isPercentDraft(text)) setFeeText((current) => ({ ...current, [key]: text }));
  };
  // On blur a valid value settles on its canonical form ("2." -> "2", "02.50" -> "2.5").
  const settlePercent = (key: keyof FeePolicy) => {
    const bps = parsePercentToBps(feeText[key]);
    if (bps !== null) setFeeText((current) => ({ ...current, [key]: bpsToPercentText(bps) }));
  };
  const bpsHint = (key: keyof FeePolicy) => (parsed[key] === null ? undefined : `${parsed[key]} bps`);

  const submitApproval = () => {
    if (!fees) return;
    decide.mutate({ action: "approve", fees, reviewWindowSeconds: Number(reviewHours) * 3600, deliveryDueAt: new Date(delivery).toISOString(), note });
  };
  const approve = () => {
    const hours = Number(reviewHours);
    if (!fees || policyError) return setError(policyError ?? "fix the fee fields");
    if (!Number.isInteger(hours) || hours < 1 || hours > 720) return setError("review window must be 1-720 hours");
    if (deliveryTooFar) return setError(`delivery must be within ${MAX_DELIVERY_DAYS} days`);
    if (blockedForReviewer) return setError(adminApprovalMessage(approvalAfterDays));
    setError(undefined);
    if (highFee) return setConfirm("high_fee");
    submitApproval();
  };
  const sendBack = (action: "request_changes" | "reject") => {
    if (!note.trim()) return setError("tell the creator why in the note");
    setError(undefined);
    if (action === "reject") return setConfirm("reject");
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
          {listing.description && <FormattedText text={listing.description} className="text-body text-muted" />}
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

          <SellerHistoryCard history={listing.sellerHistory} />

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
            <div className={auction ? "grid grid-cols-3 gap-2" : "grid grid-cols-1"}>
              {(auction
                ? ([
                    ["feeBps", "base %"],
                    ["upliftFeeBps", "uplift %"],
                    ["maxFeeBps", "cap %"],
                  ] as const)
                : ([["feeBps", "fee %"]] as const)
              ).map(([key, label]) => (
                <Input
                  key={key}
                  label={label}
                  inputMode="decimal"
                  autoComplete="off"
                  value={feeText[key]}
                  onChange={(event) => setPercent(key, event.target.value)}
                  onBlur={() => settlePercent(key)}
                  error={fieldError(key)}
                  hint={bpsHint(key)}
                />
              ))}
            </div>
            <p className="text-small text-muted">
              floor {floorBps / 100}%{auction ? " · base ≤ cap ≤ uplift" : ""}. fixed on-chain at publish; it can&apos;t be changed later.
            </p>
            {highFee && fees && (
              <p role="alert" className="flex gap-2 rounded-control bg-warning-soft px-3 py-2 text-small text-ink">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                {bpsToPercentText(effectiveMaxFeeBps(fees))}% is above the usual 10% ceiling. check it&apos;s intended.
              </p>
            )}
            {policyError || !fees ? (
              <p className="text-small text-danger">{policyError}</p>
            ) : (
              <div className="flex flex-col gap-1 rounded-card bg-canvas p-3 text-small">
                <ul className="flex flex-col gap-0.5">
                  {listing.spots.map((spot) => {
                    const price = BigInt(spot.price);
                    const fee = feeFor(listing.mode, fees, price, price);
                    return (
                      <li key={spot.id}>
                        spot {spot.index + 1} at {formatUsd(price)}: creator gets <strong>{formatUsd(price - fee)}</strong>, platform {formatUsd(fee)}
                      </li>
                    );
                  })}
                </ul>
                {auction && (
                  <p className="text-muted">
                    if spot 1 bidding reaches {formatUsd(hotAuction)}: creator gets {formatUsd(hotAuction - hotFee)}, platform {formatUsd(hotFee)}
                  </p>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Input label="deliver by" type="datetime-local" value={delivery} onChange={(event) => setDelivery(event.target.value)} />
              <Input label="review window (h)" inputMode="numeric" value={reviewHours} onChange={(event) => setReviewHours(event.target.value)} />
            </div>
            {deliveryTooFar ? (
              <p role="alert" className="text-small text-danger">
                delivery must be within {MAX_DELIVERY_DAYS} days. move the date earlier or request changes.
              </p>
            ) : (
              adminOnly && (
                <div role="note" className="flex flex-col gap-1.5 rounded-control bg-warning-soft px-3 py-2 text-small text-ink">
                  <Badge tone="warning" className="self-start">
                    admin approval
                  </Badge>
                  <p>
                    {adminApprovalMessage(approvalAfterDays)}.{" "}
                    {session?.isAdmin
                      ? "you're an admin, so you can approve it."
                      : `you can request changes, or move delivery within ${approvalAfterDays} days to approve it yourself.`}
                  </p>
                </div>
              )
            )}
            <Textarea label="note to the creator" value={note} onChange={(event) => setNote(event.target.value)} rows={3} maxLength={1000} hint="required to request changes or reject" />
            {error && (
              <p role="alert" className="text-small text-danger">
                {error}
              </p>
            )}
            <div className="flex flex-col gap-2">
              <Button onClick={approve} loading={decide.isPending && decide.variables?.action === "approve"} disabled={decide.isPending || ownListing || blockedForReviewer || deliveryTooFar}>
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
      <ConfirmModal
        open={confirm === "high_fee"}
        onClose={() => setConfirm(null)}
        onConfirm={submitApproval}
        tone="primary"
        title={`approve with a ${fees ? bpsToPercentText(effectiveMaxFeeBps(fees)) : ""}% fee?`}
        description="that's above the usual 10%. the fee is fixed on-chain when the creator publishes and can't be changed later."
        confirmLabel="approve anyway"
        cancelLabel="edit fees"
      >
        <p className="text-body text-muted">double-check the base, uplift and cap before you approve.</p>
      </ConfirmModal>
      <ConfirmModal
        open={confirm === "reject"}
        onClose={() => setConfirm(null)}
        onConfirm={() => decide.mutate({ action: "reject", note })}
        title="reject this listing?"
        description="the creator sees your note and can't resubmit this listing. this can't be undone."
        confirmLabel="reject listing"
      >
        <p className="text-body text-muted">to let them fix it instead, use request changes.</p>
      </ConfirmModal>
    </div>
  );
}

// The creator's record on their other listings (REVAMP §8 seller signals).
function SellerHistoryCard({ history }: { history: SellerHistory }) {
  if (history.listingsSubmitted === 0) {
    return <p className="rounded-panel border border-line bg-surface p-4 text-small text-muted shadow-card">first listing from this creator.</p>;
  }
  const rows: Array<[string, string, boolean?]> = [
    ["past listings", `${history.listingsSubmitted}${history.listingsRejected ? ` · ${history.listingsRejected} not approved` : ""}`],
    ["went live", String(history.listingsLive)],
    ["spots sold", String(history.spotsSold)],
    ["completed (paid out)", String(history.spotsPaidOut)],
    ["refunded", String(history.spotsRefunded), history.spotsRefunded > 0],
    ["disputes", `${history.disputes}${history.openDisputes ? ` · ${history.openDisputes} open` : ""}`, history.disputes > 0],
    ["on-time delivery", history.onTimeRate === null ? "nothing to grade yet" : `${Math.round(history.onTimeRate * 100)}%`, history.onTimeRate !== null && history.onTimeRate < 0.8],
  ];
  return (
    <section aria-labelledby="seller-history" className="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4 shadow-card">
      <h2 id="seller-history" className="text-body font-semibold">
        seller history
      </h2>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-small">
        {rows.map(([label, value, flag]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd className={flag ? "text-right font-medium text-warning" : "text-right font-medium"}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
