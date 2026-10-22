"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, PenLine } from "lucide-react";
import { cx } from "@/lib/cx";
import { Button } from "./Button";
import { Address } from "./Address";

export type TxPhase = "idle" | "signing" | "submitted" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  signature?: string;
  error?: string;
}

const copy: Record<Exclude<TxPhase, "idle">, { title: string; tone: string }> = {
  signing: { title: "waiting for signature", tone: "border-line bg-surface text-ink" },
  submitted: { title: "confirming on solana", tone: "border-accent-ring bg-accent-soft text-ink" },
  confirmed: { title: "confirmed", tone: "border-success/30 bg-success-soft text-ink" },
  failed: { title: "transaction failed", tone: "border-danger/30 bg-danger-soft text-ink" },
};

// One status surface for every on-chain action: claim, bid, proof, payout, refund, withdraw.
export function TxStatus({
  state,
  action,
  onRetry,
  className,
}: {
  state: TxState;
  action: string;
  onRetry?: () => void;
  className?: string;
}) {
  const pathname = usePathname();
  if (state.phase === "idle") return null;
  const { title, tone } = copy[state.phase];
  const Icon =
    state.phase === "signing"
      ? PenLine
      : state.phase === "submitted"
        ? Loader2
        : state.phase === "confirmed"
          ? CheckCircle2
          : AlertCircle;

  return (
    <div
      role={state.phase === "failed" ? "alert" : "status"}
      aria-live="polite"
      className={cx("flex items-start gap-3 rounded-control border px-4 py-3", tone, className)}
    >
      <Icon
        aria-hidden
        className={cx(
          "mt-0.5 size-4 shrink-0",
          state.phase === "submitted" && "animate-spin text-accent",
          state.phase === "confirmed" && "text-success",
          state.phase === "failed" && "text-danger",
        )}
      />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          {action}: {title}
        </p>
        {state.phase === "failed" && state.error && (
          <p className="mt-0.5 text-small text-muted">{state.error}</p>
        )}
        {state.phase === "failed" && (
          // The request records this page; the server attaches the failed transaction itself.
          <Link href={`/help?topic=bug&from=${encodeURIComponent(pathname)}#contact`} className="mt-1 inline-block text-small font-medium text-accent hover:underline">
            get help with this
          </Link>
        )}
        {state.signature && <Address value={state.signature} kind="tx" chars={6} prefix="tx " className="mt-1 text-small" />}
      </div>
      {state.phase === "failed" && onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          retry
        </Button>
      )}
    </div>
  );
}
