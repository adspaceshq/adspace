"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import { ago } from "@/lib/activity";
import { explorerTxUrl } from "@/lib/chain-config";
import { useNow } from "@/lib/use-now";
import { Money } from "@/components/ui/Money";
import { UserLink } from "@/components/ui/UserLink";

const PREVIEW = 5;

export function BidHistory({ spotId, live }: { spotId: string; live: boolean }) {
  const now = useNow(30_000);
  const [all, setAll] = useState(false);
  const query = useQuery({
    queryKey: ["bids", spotId],
    queryFn: () => api.spots.bids(spotId),
    refetchInterval: live ? 30_000 : false,
  });
  const items = query.data?.items ?? [];
  if (query.isPending || items.length === 0) {
    return query.isPending ? null : <p className="text-small text-muted">no bids yet. the first bid sets the pace.</p>;
  }
  const shown = all ? items : items.slice(0, PREVIEW);

  return (
    <section aria-labelledby={`bids-${spotId}`} className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 id={`bids-${spotId}`} className="flex items-baseline justify-between text-small font-semibold">
        bid history
        <span className="font-normal text-muted">
          {items.length} bid{items.length === 1 ? "" : "s"} · {query.data!.bidders} bidder{query.data!.bidders === 1 ? "" : "s"}
        </span>
      </h3>
      <ol className="flex flex-col">
        {shown.map((bid) => (
          <li key={bid.id} className="flex items-center gap-2 py-1.5 text-small">
            <span className={`min-w-0 flex-1 truncate ${bid.isYou ? "font-medium text-ink" : "text-muted"}`}>
              {bid.isYou ? "you" : bid.profile ? <UserLink handle={bid.profile.handle} /> : bid.bidder}
              {bid.isTop && <span className="ml-1.5 rounded-full bg-success-soft px-1.5 py-0.5 text-caption font-medium text-success">leading</span>}
            </span>
            <Money value={bid.amount} className={bid.isTop ? "font-semibold" : ""} />
            <time dateTime={bid.createdAt} className="w-8 shrink-0 text-right text-caption text-subtle">
              {ago(bid.createdAt, now)}
            </time>
            {bid.signature ? (
              <a href={explorerTxUrl(bid.signature)} target="_blank" rel="noreferrer" aria-label="view bid on explorer" className="shrink-0 text-subtle hover:text-accent">
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : (
              <span className="w-3.5 shrink-0" />
            )}
          </li>
        ))}
      </ol>
      {items.length > PREVIEW && (
        <button type="button" onClick={() => setAll((value) => !value)} className="cursor-pointer self-start text-small font-medium text-accent hover:underline">
          {all ? "show less" : `show all ${items.length} bids`}
        </button>
      )}
    </section>
  );
}
