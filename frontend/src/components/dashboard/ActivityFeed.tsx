"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { api } from "@/lib/api/v2";
import { explorerTxUrl } from "@/lib/chain-config";
import { queryKeys } from "@/lib/query";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

const LABELS: Record<string, string> = {
  claimed: "spot claimed",
  bid_placed: "new bid",
  outbid: "new top bid",
  proof_submitted: "proof submitted",
  dispute_raised: "dispute opened",
  dispute_withdrawn: "dispute withdrawn",
  dispute_resolved: "dispute resolved",
  dispute_timed_out: "dispute timed out",
  seller_paid: "payout sent",
  refunded: "refund sent",
  closed: "spot closed",
};

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

export function ActivityFeed({ limit = 8 }: { limit?: number }) {
  const query = useQuery({ queryKey: queryKeys.activity, queryFn: () => api.me.activity(), refetchInterval: 30_000 });
  const items = (query.data ?? []).slice(0, limit);
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-body font-semibold">activity</h2>
        <Link href="/activity" className="text-small text-accent hover:underline">
          see all
        </Link>
      </div>
      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length === 0 ? (
        <p className="py-6 text-center text-small text-muted">nothing yet. claims, bids and payouts show up here.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <li key={item.id} className="flex items-start gap-2 text-small">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium text-ink">{LABELS[item.type] ?? item.type.replace(/_/g, " ")}</span>
                  <span className="text-muted"> · spot {item.spotIndex + 1}</span>
                </p>
                <p className="truncate text-muted">{item.listingTitle}</p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-subtle">
                {ago(item.createdAt)}
                {item.signature && (
                  <a href={explorerTxUrl(item.signature)} target="_blank" rel="noreferrer" aria-label="view on explorer" className="hover:text-accent">
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
