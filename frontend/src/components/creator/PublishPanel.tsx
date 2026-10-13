"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BadgeCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { OwnedListing } from "@/lib/api/types";
import { formatUsd, percentOf } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { TxStatus } from "@/components/ui/TxStatus";
import { GaslessPrompt } from "@/components/app/GaslessPrompt";

const pct = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const date = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Approved listings: show the exact deal the reviewer set, then accept and publish on-chain.
export function PublishPanel({ listing }: { listing: OwnedListing }) {
  const { wallet } = useSession();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const tx = useTx(async () => {
    const published = await api.listings.publish(listing.id);
    return { signature: undefined, published };
  });
  const sample = listing.spots[0]?.price ?? "0";
  const fee = percentOf(sample, listing.feeBps ?? 0);
  const resuming = listing.state === "publishing";

  const publish = async () => {
    if (await tx.execute()) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "listing", listing.id] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard }),
      ]);
    }
  };

  return (
    <section className="flex flex-col gap-4 rounded-panel border border-success/30 bg-surface p-5 shadow-card">
      <div className="flex items-center gap-2">
        <BadgeCheck className="size-5 text-success" aria-hidden />
        <h2 className="text-lead font-semibold">{resuming ? "finish publishing" : "approved by the adspaces team"}</h2>
      </div>
      {listing.reviewNote && <p className="rounded-control bg-canvas px-3 py-2 text-body text-muted">&ldquo;{listing.reviewNote}&rdquo;</p>}
      <dl className="grid gap-3 text-body sm:grid-cols-2">
        <div className="rounded-card bg-canvas p-3">
          <dt className="text-small text-muted">on a {formatUsd(sample)} spot you get</dt>
          <dd className="text-title font-semibold">{formatUsd(BigInt(sample) - fee)}</dd>
          <dd className="text-small text-muted">
            platform fee {pct(listing.feeBps ?? 0)} ({formatUsd(fee)})
          </dd>
        </div>
        {listing.mode === "auction" && (
          <div className="rounded-card bg-canvas p-3 text-small text-muted">
            <dt className="font-medium text-ink">auction fees</dt>
            <dd>
              {pct(listing.feeBps ?? 0)} on the starting price, {pct(listing.upliftFeeBps ?? 0)} on anything above it, never more than{" "}
              {pct(listing.maxFeeBps ?? 0)} in total.
            </dd>
          </div>
        )}
        <div className="rounded-card bg-canvas p-3 text-small text-muted">
          <dt className="font-medium text-ink">dates</dt>
          <dd>claims close {date(listing.deadline)}</dd>
          <dd>deliver by {date(listing.deliveryDueAt)}</dd>
          <dd>sponsor review {Math.round(listing.reviewWindowSeconds / 3600)}h after that</dd>
        </div>
      </dl>
      {!wallet.delegated ? (
        <GaslessPrompt action="publish" />
      ) : (
        <>
          {!resuming && (
            <label className="flex cursor-pointer items-start gap-2 text-body">
              <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} className="mt-1 size-4 accent-ink" />
              <span>
                I accept the{" "}
                <a href="/terms" target="_blank" className="text-accent hover:underline">
                  adspaces terms
                </a>{" "}
                and will deliver every sold spot by the deadline.
              </span>
            </label>
          )}
          <Button size="lg" onClick={() => void publish()} loading={tx.busy} disabled={!resuming && !accepted}>
            {resuming ? "resume publishing" : "accept & publish"}
          </Button>
          <p className="text-small text-muted">publishing creates your listing and each spot on Solana. a small amount of SOL for rent is covered for you.</p>
          <TxStatus state={tx.state} action="publish" onRetry={tx.retry} />
        </>
      )}
    </section>
  );
}
