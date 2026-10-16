"use client";

import { PauseCircle } from "lucide-react";
import { usePaused } from "@/lib/use-status";
import { cx } from "@/lib/cx";

export const PAUSED_TITLE = "trading is paused";
export const PAUSED_DETAIL = "payouts, refunds and disputes still work.";

// Shown on every page while the protocol is paused on-chain; claims, bids and publishing are disabled.
export function PausedBanner({ variant = "bar", className }: { variant?: "bar" | "inline"; className?: string }) {
  const paused = usePaused();
  if (!paused) return null;
  if (variant === "inline") {
    return (
      <p role="status" className={cx("flex items-start gap-2 rounded-control bg-warning-soft px-3 py-2 text-small text-ink", className)}>
        <PauseCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-semibold">{PAUSED_TITLE}.</span> {PAUSED_DETAIL}
        </span>
      </p>
    );
  }
  return (
    <div role="status" className={cx("border-b border-warning/30 bg-warning-soft text-ink", className)}>
      <p className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-4 py-1.5 text-center text-small sm:px-6">
        <PauseCircle className="size-4 shrink-0 text-warning" aria-hidden />
        <span>
          <span className="font-semibold">{PAUSED_TITLE}.</span> {PAUSED_DETAIL}
        </span>
      </p>
    </div>
  );
}
