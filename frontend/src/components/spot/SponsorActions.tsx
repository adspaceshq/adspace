"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SpotDetail } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { ConfirmModal } from "@/components/ui/ConfirmModal";
import { Countdown } from "@/components/ui/Countdown";
import { Textarea } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Modal";
import { Money } from "@/components/ui/Money";
import { SpotStateBadge } from "@/components/ui/StateBadge";
import { TxStatus } from "@/components/ui/TxStatus";
import { GaslessPrompt } from "@/components/app/GaslessPrompt";
import { UserLink } from "@/components/ui/UserLink";

function useRefreshSpot(spotId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.spot(spotId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.timeline(spotId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.sponsorDashboard }),
      queryClient.invalidateQueries({ queryKey: ["balance"] }),
    ]);
}

function Block({ icon: Icon, tone, title, children }: { icon: typeof Clock; tone: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${tone}`}>
          <Icon className="size-4" aria-hidden />
        </span>
        <div>
          <p className="text-body font-semibold">{title}</p>
          <div className="mt-0.5 text-small text-muted">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function SponsorActions({ detail, now }: { detail: SpotDetail; now: number }) {
  const { spot, dispute, deadlines, settlement, seller } = detail;
  const refresh = useRefreshSpot(spot.id);
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [confirmWithdraw, setConfirmWithdraw] = useState(false);
  const refund = useTx(() => api.spots.refund(spot.id, false));
  const withdraw = useTx(() => api.spots.withdrawDispute(spot.id));
  const timeout = useTx(() => api.spots.timeoutDispute(spot.id));
  const run = async (tx: { execute: () => Promise<unknown> }) => {
    if (await tx.execute()) await refresh();
  };

  const deliveryPassed = now >= new Date(deadlines.deliveryDueAt).getTime();
  const reviewOpen = now < new Date(deadlines.reviewUntil).getTime();
  const timedOut = dispute?.state === "open" && now >= new Date(dispute.timeoutAt).getTime();

  let body: React.ReactNode;
  if (spot.state === "funded" && !deliveryPassed) {
    body = (
      <Block icon={Clock} tone="bg-accent-soft text-accent" title="waiting for delivery">
        <UserLink handle={seller.handle} /> has until <Countdown to={deadlines.deliveryDueAt} className="font-medium text-ink" /> to place your brand and post
        proof. your USDC stays in escrow until then.
      </Block>
    );
  } else if (spot.state === "funded") {
    body = (
      <>
        <Block icon={AlertTriangle} tone="bg-warning-soft text-warning" title="not delivered on time">
          no proof arrived before the delivery deadline. you can take a full refund now, or open a dispute if something else went wrong.
        </Block>
        <Button onClick={() => void run(refund)} loading={refund.busy}>
          get a full refund
        </Button>
        <Button variant="secondary" onClick={() => setDisputeOpen(true)}>
          open a dispute
        </Button>
        <TxStatus state={refund.state} action="refund" onRetry={refund.retry} />
      </>
    );
  } else if (spot.state === "delivered" && reviewOpen) {
    body = (
      <>
        <Block icon={ShieldCheck} tone="bg-success-soft text-success" title="check the delivery">
          <UserLink handle={seller.handle} /> posted proof. if it looks right, there&apos;s nothing to do: they&apos;re paid when your review window closes in{" "}
          <Countdown to={deadlines.reviewUntil} className="font-medium text-ink" />.
        </Block>
        <Button variant="secondary" onClick={() => setDisputeOpen(true)}>
          something&apos;s wrong, open a dispute
        </Button>
      </>
    );
  } else if (spot.state === "delivered") {
    body = (
      <Block icon={CheckCircle2} tone="bg-success-soft text-success" title="delivered">
        your review window has closed. the creator&apos;s payout is being released.
      </Block>
    );
  } else if (spot.state === "disputed" && dispute) {
    body = (
      <>
        <Block icon={AlertTriangle} tone="bg-warning-soft text-warning" title="dispute open">
          the adspaces team is reviewing it.{" "}
          {timedOut ? (
            "it wasn't resolved in time, so you can take a full refund now."
          ) : (
            <>
              if it isn&apos;t resolved in <Countdown to={dispute.timeoutAt} className="font-medium text-ink" />, you can take a full refund.
            </>
          )}
        </Block>
        <blockquote className="rounded-control bg-canvas px-3 py-2 text-small text-muted">&ldquo;{dispute.reason}&rdquo;</blockquote>
        {timedOut && (
          <Button onClick={() => void run(timeout)} loading={timeout.busy}>
            get my refund
          </Button>
        )}
        <Button variant="secondary" onClick={() => setConfirmWithdraw(true)} loading={withdraw.busy}>
          withdraw dispute
        </Button>
        <ConfirmModal
          open={confirmWithdraw}
          onClose={() => setConfirmWithdraw(false)}
          onConfirm={() => void run(withdraw)}
          title="withdraw your dispute?"
          description={
            spot.proofSubmittedAt
              ? `the dispute closes now and @${seller.handle} is paid from escrow when your review window ends. withdrawing can't be undone.`
              : "the dispute closes now. no proof was posted, so you can still take a full refund. withdrawing can't be undone."
          }
          confirmLabel="withdraw dispute"
          cancelLabel="keep dispute"
        />
        <TxStatus state={timeout.state} action="refund" onRetry={timeout.retry} />
        <TxStatus state={withdraw.state} action="withdraw dispute" onRetry={withdraw.retry} />
      </>
    );
  } else if (settlement) {
    const refunded = BigInt(settlement.buyerRefund);
    body = (
      <Block icon={CheckCircle2} tone="bg-success-soft text-success" title={refunded > 0n && settlement.kind !== "dispute_split" ? "refunded" : "complete"}>
        {settlement.kind === "payout" && (
          <>
            delivered and paid out. <Money value={settlement.gross} /> released to <UserLink handle={seller.handle} />.
          </>
        )}
        {(settlement.kind === "refund" || settlement.kind === "timeout_refund") && (
          <>
            <Money value={settlement.buyerRefund} /> returned to your wallet.
          </>
        )}
        {settlement.kind === "dispute_split" && (
          <>
            resolved: <Money value={settlement.buyerRefund} /> refunded to you, <Money value={settlement.sellerNet} /> paid to the creator.
          </>
        )}
      </Block>
    );
  } else {
    body = <p className="text-small text-muted">nothing to do right now.</p>;
  }

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <p className="text-small text-muted">
          you paid <Money value={spot.amount} className="font-semibold text-ink" />
        </p>
        <SpotStateBadge state={spot.state} perspective="sponsor" />
      </div>
      {body}
      <DisputeSheet spotId={spot.id} open={disputeOpen} onClose={() => setDisputeOpen(false)} onDone={refresh} />
    </div>
  );
}

function DisputeSheet({ spotId, open, onClose, onDone }: { spotId: string; open: boolean; onClose: () => void; onDone: () => Promise<unknown> }) {
  const { wallet } = useSession();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const tx = useTx((text: string) => api.spots.raiseDispute(spotId, text));

  const submit = async () => {
    if (reason.trim().length < 10) return setError("explain what went wrong in at least 10 characters");
    setError(undefined);
    if (await tx.execute(reason.trim())) {
      await onDone();
      onClose();
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="open a dispute"
      description="the adspaces team reviews the proof and your reason, then splits or refunds the escrow."
      footer={
        wallet.delegated ? (
          <>
            <Button variant="ghost" onClick={onClose} disabled={tx.busy}>
              cancel
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={tx.busy}>
              open dispute
            </Button>
          </>
        ) : undefined
      }
    >
      {wallet.delegated ? (
        <div className="flex flex-col gap-4">
          <Textarea
            label="what went wrong?"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={error}
            hint="be specific: where the brand should have been, what's missing, links to anything relevant."
            maxLength={2000}
            rows={5}
            disabled={tx.busy}
          />
          <TxStatus state={tx.state} action="dispute" onRetry={tx.retry} />
        </div>
      ) : (
        <GaslessPrompt action="open a dispute" />
      )}
    </Modal>
  );
}
