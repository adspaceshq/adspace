"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api/v2";
import { explorerTxUrl } from "@/lib/chain-config";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

const LABELS: Record<string, string> = {
  claimed: "spot claimed",
  bid_placed: "bid placed",
  outbid: "new top bid",
  proof_submitted: "proof of delivery submitted",
  dispute_raised: "dispute opened",
  dispute_withdrawn: "dispute withdrawn",
  dispute_resolved: "dispute resolved",
  dispute_timed_out: "dispute timed out, sponsor refunded",
  seller_paid: "creator paid",
  refunded: "sponsor refunded",
  closed: "spot closed",
};

function detail(type: string, data: Record<string, unknown>) {
  if ((type === "claimed" || type === "bid_placed" || type === "outbid") && typeof data.amount === "string") return formatUsd(data.amount);
  if (type === "seller_paid" && typeof data.gross === "string") return `${formatUsd(data.gross)} released from escrow`;
  if (type === "refunded" && typeof data.amount === "string") return `${formatUsd(data.amount)} returned`;
  return null;
}

export function SpotActivity({ spotId }: { spotId: string }) {
  const query = useQuery({ queryKey: queryKeys.timeline(spotId), queryFn: () => api.spots.timeline(spotId) });
  if (query.isPending) {
    return (
      <SkeletonGroup label="loading activity">
        <Skeleton className="h-24 w-full" />
      </SkeletonGroup>
    );
  }
  const events = query.data?.events ?? [];
  if (events.length === 0) return <p className="text-small text-muted">no activity yet.</p>;
  return (
    <ol className="flex flex-col">
      {events.map((event, index) => {
        const extra = detail(event.type, event.data);
        return (
          <li key={event.id} className="relative flex gap-3 pb-5 last:pb-0">
            {index < events.length - 1 && <span aria-hidden className="absolute left-[5px] top-4 h-[calc(100%-0.75rem)] w-px bg-line" />}
            <span aria-hidden className="relative z-10 mt-1.5 size-[11px] shrink-0 rounded-full border-2 border-ink bg-surface" />
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">{LABELS[event.type] ?? event.type.replace(/_/g, " ")}</p>
              <p className="flex flex-wrap items-center gap-x-2 text-small text-muted">
                <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                {extra && <span>· {extra}</span>}
                {event.signature && (
                  <a href={explorerTxUrl(event.signature)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                    explorer <ExternalLink className="size-3" aria-hidden />
                  </a>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
