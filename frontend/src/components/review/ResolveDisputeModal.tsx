"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import type { ReviewSummary, SquadsPending } from "@/lib/api/types";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { TxStatus } from "@/components/ui/TxStatus";
import { SquadsPendingNote } from "./SquadsPendingNote";

// Amounts shown before the platform fee; the creator's share pays a proportional fee on-chain.
export function ResolveDisputeModal({ item, onClose }: { item: ReviewSummary["disputes"][number]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [share, setShare] = useState(50);
  const [decision, setDecision] = useState("");
  const [error, setError] = useState<string>();
  // Set when the multisig is the config authority: the decision went to Squads instead of the chain.
  const [pending, setPending] = useState<SquadsPending>();
  const tx = useTx(() => api.review.resolveDispute(item.spotId, share * 100, decision.trim()));
  const amount = BigInt(item.amount ?? 0);
  const toCreator = (amount * BigInt(share * 100)) / 10_000n;

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
      title={`resolve: ${item.listingTitle}, spot ${item.spotIndex + 1}`}
      description={`@${item.buyerHandle} (sponsor) vs @${item.sellerHandle} (creator)`}
      footer={
        pending ? (
          <Button onClick={onClose}>done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              cancel
            </Button>
            <Button onClick={() => void resolve()} loading={tx.busy}>
              resolve on-chain
            </Button>
          </>
        )
      }
    >
      {pending ? (
        <SquadsPendingNote index={pending.transactionIndex} url={pending.url}>
          the creator gets {share}%. the dispute stays open until multisig members approve and execute it, then settles here on its own.
        </SquadsPendingNote>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="share" className="text-small font-medium">
              creator receives {share}%
            </label>
            <input id="share" type="range" min={0} max={100} step={5} value={share} onChange={(event) => setShare(Number(event.target.value))} className="accent-ink" disabled={tx.busy} />
            <div className="grid grid-cols-2 gap-3 text-body">
              <div className="rounded-card bg-canvas p-3">
                <p className="text-small text-muted">to the creator (before fee)</p>
                <p className="font-semibold tabular-nums">{formatUsd(toCreator)}</p>
              </div>
              <div className="rounded-card bg-canvas p-3">
                <p className="text-small text-muted">refunded to the sponsor</p>
                <p className="font-semibold tabular-nums">{formatUsd(amount - toCreator)}</p>
              </div>
            </div>
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
          <TxStatus state={tx.state} action="resolve" onRetry={tx.retry} />
        </div>
      )}
    </Modal>
  );
}
