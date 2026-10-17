"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import type { ReviewSummary, SquadsPending, StaleSquadsProposal } from "@/lib/api/types";
import { disputeSplit, listingFeePolicy } from "@/lib/fees";
import { userErrorMessage } from "@/lib/errors";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useTx } from "@/lib/use-tx";
import { useNow } from "@/lib/use-now";
import { resolveBlockedReason } from "@/lib/dispute-rules";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { TxStatus } from "@/components/ui/TxStatus";
import { DisputeEvidence } from "@/components/spot/DisputeEvidence";
import { SquadsPendingNote } from "./SquadsPendingNote";
import { StaleProposals } from "./StaleProposals";

// Under 24h a 2-of-3 multisig approval is at risk of missing the timeout.
export const DISPUTE_URGENT_MS = 24 * 60 * 60 * 1000;

// `viaMultisig`: the config authority is the Squads vault, so the decision becomes a proposal.
// `stale`: proposals made for an earlier dispute on this spot (withdrawn, then raised again). They can't
// settle this one (the program checks the dispute's open time and evidence), but should be cancelled.
export function ResolveDisputeModal({
  item,
  viaMultisig,
  stale = [],
  onClose,
}: {
  item: ReviewSummary["disputes"][number];
  viaMultisig: boolean;
  stale?: StaleSquadsProposal[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.spot(item.spotId), queryFn: () => api.spots.detail(item.spotId) });
  const [share, setShare] = useState(50);
  const [decision, setDecision] = useState("");
  const [error, setError] = useState<string>();
  // Set when the multisig is the config authority: the decision went to Squads instead of the chain.
  const [pending, setPending] = useState<SquadsPending>();
  const tx = useTx(() => api.review.resolveDispute(item.spotId, share * 100, decision.trim()));
  const now = useNow(30_000);
  const blocked = resolveBlockedReason(item.timeoutAt, viaMultisig, now);

  // The program splits the vault balance, which is what the sponsor paid.
  const amount = BigInt(item.amount ?? 0);
  const data = detail.data;
  const listing = data?.listing;
  const fees = listing ? listingFeePolicy(listing) : null;
  const split = data && listing && fees ? disputeSplit(listing.mode, fees, BigInt(data.spot.price), amount, share * 100) : null;

  const resolve = async () => {
    if (decision.trim().length < 10) return setError("explain the decision in at least 10 characters");
    setError(undefined);
    const result = await tx.execute();
    if (!result) return;
    await queryClient.invalidateQueries({ queryKey: queryKeys.reviewSummary });
    if (result.pending) setPending(result.pending);
    else onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      className="sm:max-w-3xl"
      title={`${viaMultisig ? "propose a decision" : "resolve"}: ${item.listingTitle}, spot ${item.spotIndex + 1}`}
      description={`@${item.buyerHandle} (sponsor) vs @${item.sellerHandle} (creator)`}
      footer={
        pending ? (
          <Button onClick={onClose}>done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              cancel
            </Button>
            <Button onClick={() => void resolve()} loading={tx.busy} disabled={Boolean(blocked)}>
              {viaMultisig ? "propose to the multisig" : "resolve"}
            </Button>
          </>
        )
      }
    >
      {pending ? (
        <SquadsPendingNote index={pending.transactionIndex} url={pending.url}>
          the creator gets {share}%. the dispute stays open until multisig members approve and execute it, then settles here on its own. it must execute
          before the timeout, or the sponsor can take a full refund.
        </SquadsPendingNote>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-small text-muted">
            times out <Countdown to={item.timeoutAt} prefix="in" endedLabel="now: the sponsor can take a full refund" urgentWithinMs={DISPUTE_URGENT_MS} className="font-medium" />
            {viaMultisig ? ". multisig members still need to approve and execute after you propose." : "."}
          </p>
          <StaleProposals items={stale} compact />
          {blocked && (
            <p role="alert" className="rounded-control bg-danger-soft px-3 py-2 text-small text-danger">
              {blocked}
            </p>
          )}
          {detail.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : detail.isError ? (
            <p className="text-small text-danger">{userErrorMessage(detail.error)}</p>
          ) : (
            detail.data.dispute && <DisputeEvidence dispute={detail.data.dispute} proofPosts={detail.data.proofPosts} headingLevel="h3" />
          )}
          <div className="flex flex-col gap-2">
            <label htmlFor="share" className="text-small font-medium">
              creator receives {share}% of the escrow
            </label>
            <input id="share" type="range" min={0} max={100} step={5} value={share} onChange={(event) => setShare(Number(event.target.value))} className="h-11 accent-ink" disabled={tx.busy} />
            <dl className="grid grid-cols-1 gap-2 text-body sm:grid-cols-3">
              <div className="rounded-card bg-canvas p-3">
                <dt className="text-small text-muted">refund to the sponsor</dt>
                <dd className="font-semibold tabular-nums">{formatUsd(split?.buyerRefund ?? amount - (amount * BigInt(share * 100)) / 10_000n)}</dd>
              </div>
              <div className="rounded-card bg-canvas p-3">
                <dt className="text-small text-muted">platform fee</dt>
                <dd className="font-semibold tabular-nums">{split ? formatUsd(split.fee) : "…"}</dd>
              </div>
              <div className="rounded-card bg-canvas p-3">
                <dt className="text-small text-muted">creator receives</dt>
                <dd className="font-semibold tabular-nums">{split ? formatUsd(split.creatorNet) : "…"}</dd>
              </div>
            </dl>
            <p className="text-caption text-muted">
              the fee is the listing&apos;s fee scaled by the creator&apos;s share, rounded down, as the program computes it.
              {listing && !fees && " this listing has no fee snapshot, so the fee can't be previewed."}
            </p>
          </div>
          <Textarea
            label="decision"
            hint="both parties see this. reference the proof and the dispute reason."
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
            error={error}
            rows={4}
            maxLength={2000}
            disabled={tx.busy}
          />
          <TxStatus state={tx.state} action={viaMultisig ? "proposal" : "resolve"} onRetry={tx.retry} />
        </div>
      )}
    </Modal>
  );
}
