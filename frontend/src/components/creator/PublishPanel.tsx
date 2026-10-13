"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { BadgeCheck, CalendarClock, PackageCheck, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { OwnedListing } from "@/lib/api/types";
import { DEFAULT_FEES, feeFor } from "@/lib/fees";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { TxStatus } from "@/components/ui/TxStatus";
import { GaslessPrompt } from "@/components/app/GaslessPrompt";

const pct = (bps: number) => `${(bps / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;
const date = (value: string | Date) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// Approved listings: show the exact deal the reviewer set, then accept and publish on-chain.
export function PublishPanel({ listing }: { listing: OwnedListing }) {
  const { wallet } = useSession();
  const queryClient = useQueryClient();
  const [accepted, setAccepted] = useState(false);
  const tx = useTx(async () => {
    const published = await api.listings.publish(listing.id);
    return { signature: undefined, published };
  });
  const resuming = listing.state === "publishing";
  const auction = listing.mode === "auction";

  // The reviewer's policy, falling back to the defaults for the mode; same integer math as the program.
  const defaults = DEFAULT_FEES[listing.mode];
  const policy = {
    feeBps: listing.feeBps ?? defaults.feeBps,
    upliftFeeBps: listing.upliftFeeBps ?? defaults.upliftFeeBps,
    maxFeeBps: listing.maxFeeBps ?? defaults.maxFeeBps,
  };
  const rows = listing.spots.map((spot) => {
    const price = BigInt(spot.price);
    const fee = feeFor(listing.mode, policy, price, price);
    return { id: spot.id, index: spot.index, label: spot.label, price, fee, net: price - fee };
  });
  const total = rows.reduce((sum, row) => ({ price: sum.price + row.price, net: sum.net + row.net }), { price: 0n, net: 0n });
  const reviewEnds = new Date(new Date(listing.deliveryDueAt).getTime() + listing.reviewWindowSeconds * 1000);

  const timeline = [
    { icon: CalendarClock, label: auction ? "bidding closes" : "claims close", at: listing.deadline },
    { icon: PackageCheck, label: "deliver and post proof by", at: listing.deliveryDueAt },
    { icon: ShieldCheck, label: "sponsor review ends", at: reviewEnds },
  ];

  const publish = async () => {
    if (await tx.execute()) {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me", "listing", listing.id] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard }),
      ]);
    }
  };

  return (
    <section className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
      <header className="flex flex-col gap-1 border-b border-line bg-success-soft/60 px-5 py-4">
        <div className="flex items-center gap-2">
          <BadgeCheck className="size-5 text-success" aria-hidden />
          <h2 className="text-lead font-semibold">{resuming ? "finish publishing" : "approved, ready to publish"}</h2>
        </div>
        <p className="text-small text-muted">
          {resuming ? "publishing was interrupted. pick up where it stopped." : "check the deal below. once published, sponsors can claim or bid on your spots."}
        </p>
      </header>

      <div className="flex flex-col gap-5 p-5">
        {listing.reviewNote && (
          <p className="rounded-control border border-line bg-canvas px-3 py-2 text-body">
            <span className="text-small text-muted">note from the reviewer: </span>&ldquo;{listing.reviewNote}&rdquo;
          </p>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-small font-medium uppercase tracking-wide text-muted">what you get{auction ? " at the starting bid" : ""}</h3>
          <div className="overflow-x-auto rounded-card border border-line">
            <table className="w-full text-body">
              <thead className="bg-canvas text-small text-muted">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">spot</th>
                  <th className="px-3 py-2 text-right font-medium">{auction ? "starting bid" : "price"}</th>
                  <th className="px-3 py-2 text-right font-medium">fee</th>
                  <th className="px-3 py-2 text-right font-medium">you get</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2">
                      spot {row.index + 1}
                      {row.label && <span className="text-muted"> · {row.label}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(row.price)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted">-{formatUsd(row.fee)}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatUsd(row.net)}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot className="border-t border-line bg-canvas">
                  <tr>
                    <td className="px-3 py-2 text-small text-muted">if every spot sells</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatUsd(total.price)}</td>
                    <td />
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{formatUsd(total.net)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="text-small text-muted">
            {auction
              ? `fee: ${pct(policy.feeBps)} up to the starting bid, ${pct(policy.upliftFeeBps)} on anything bid above it, never more than ${pct(policy.maxFeeBps)} in total. higher bids pay you more.`
              : `fee: ${pct(policy.feeBps)} of the price, taken when you're paid.`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-small font-medium uppercase tracking-wide text-muted">timeline</h3>
          <ol className="grid gap-3 sm:grid-cols-3">
            {timeline.map((step, index) => (
              <li key={step.label} className="flex items-start gap-3 rounded-card border border-line p-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink">
                  <step.icon className="size-4" aria-hidden />
                </span>
                <span className="flex flex-col">
                  <span className="text-small text-muted">
                    {index + 1}. {step.label}
                  </span>
                  <span className="text-body font-medium">{date(step.at)}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {!wallet.delegated ? (
          <GaslessPrompt action="publish" />
        ) : (
          <div className="flex flex-col gap-3 border-t border-line pt-5">
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
            <p className="text-center text-small text-muted">publishing puts your listing and spots on Solana. network fees and rent are covered for you.</p>
            <TxStatus state={tx.state} action="publish" onRetry={tx.retry} />
          </div>
        )}
      </div>
    </section>
  );
}
