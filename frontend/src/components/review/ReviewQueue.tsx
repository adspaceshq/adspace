"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Settings2 } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { ReviewSummary } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { useTx } from "@/lib/use-tx";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Money } from "@/components/ui/Money";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { TxStatus } from "@/components/ui/TxStatus";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { ResolveDisputeModal } from "./ResolveDisputeModal";
import { Address } from "@/components/ui/Address";

type Tab = "listings" | "disputes" | "payouts" | "failed";
const TABS: Tab[] = ["listings", "disputes", "payouts", "failed"];

export function ReviewQueue() {
  const params = useSearchParams();
  const tab = (TABS.includes(params.get("tab") as Tab) ? params.get("tab") : "listings") as Tab;
  const summary = useQuery({ queryKey: queryKeys.reviewSummary, queryFn: () => api.review.summary(), refetchInterval: 30_000 });
  const counts = summary.data?.counts;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold sm:text-display">review</h1>
          <p className="text-body text-muted">approve listings, settle disputes, keep money moving.</p>
        </div>
        <Link href="/review/ops" className="inline-flex items-center gap-1.5 rounded-control border border-line bg-surface px-3 py-2 text-small font-medium hover:border-line-strong">
          <Settings2 className="size-4" aria-hidden /> ops
        </Link>
      </div>
      <Tabs
        active={`/review?tab=${tab}`}
        items={[
          { href: "/review?tab=listings", label: "listings", count: counts?.listingsInReview },
          { href: "/review?tab=disputes", label: "disputes", count: counts?.openDisputes },
          { href: "/review?tab=payouts", label: "payouts ready", count: counts?.payoutsReady },
          { href: "/review?tab=failed", label: "failed txs", count: counts?.failedTxs },
        ]}
      />
      {tab === "listings" && <ListingsTab />}
      {tab !== "listings" && (summary.isPending ? <Skeleton className="h-40 w-full" /> : summary.data && <SummaryTab tab={tab} data={summary.data} />)}
    </div>
  );
}

function ListingsTab() {
  const query = useQuery({ queryKey: queryKeys.reviewQueue, queryFn: () => api.review.queue(), refetchInterval: 30_000 });
  if (query.isPending) return <Skeleton className="h-40 w-full" />;
  const items = query.data ?? [];
  if (items.length === 0) return <EmptyState icon={CheckCircle2} title="no listings waiting" description="new submissions show up here, oldest first." />;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((listing) => (
        <li key={listing.id}>
          <Link href={`/review/listings/${listing.id}`} className="flex items-center gap-4 rounded-card border border-line bg-surface p-3 shadow-card hover:border-line-strong">
            {listing.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element -- queue thumbnail
              <img src={listing.photos[0].url} alt="" className="size-16 shrink-0 rounded-control object-cover" />
            ) : (
              <span className="size-16 shrink-0 rounded-control bg-ink/5" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-semibold">{listing.title}</p>
              <p className="flex items-center gap-1.5 truncate text-small text-muted">
                <SellerAvatar seller={listing.seller} size={16} />@{listing.seller.handle} · {listing.spots.length} spots · {listing.mode}
              </p>
            </div>
            <span className="shrink-0 text-small text-muted">
              submitted {new Date(listing.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function SummaryTab({ tab, data }: { tab: Exclude<Tab, "listings">; data: ReviewSummary }) {
  const [resolving, setResolving] = useState<ReviewSummary["disputes"][number] | null>(null);
  if (tab === "disputes") {
    if (data.disputes.length === 0) return <EmptyState icon={CheckCircle2} title="no open disputes" />;
    return (
      <>
        <ul className="flex flex-col gap-2">
          {data.disputes.map((item) => (
            <li key={item.dispute.id} className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-semibold">
                  {item.listingTitle} · spot {item.spotIndex + 1}
                </p>
                <Money value={item.amount} className="text-body font-semibold" />
              </div>
              <p className="text-small text-muted">
                @{item.buyerHandle} disputes @{item.sellerHandle} · opened {new Date(item.dispute.openedAt).toLocaleString()}
              </p>
              <blockquote className="rounded-control bg-canvas px-3 py-2 text-body">&ldquo;{item.dispute.reason}&rdquo;</blockquote>
              <div className="flex gap-2">
                <Link href={`/dashboard/spots/${item.spotId}`} className="rounded-control border border-line px-3 py-1.5 text-small font-medium hover:border-line-strong">
                  view proof & messages
                </Link>
                <Button size="sm" onClick={() => setResolving(item)}>
                  resolve
                </Button>
              </div>
            </li>
          ))}
        </ul>
        {resolving && <ResolveDisputeModal item={resolving} onClose={() => setResolving(null)} />}
      </>
    );
  }
  if (tab === "payouts") {
    if (data.payoutsReady.length === 0) return <EmptyState icon={CheckCircle2} title="no payouts waiting" description="delivered spots appear here once their review window closes." />;
    return (
      <ul className="flex flex-col gap-2">
        {data.payoutsReady.map((item) => (
          <PayoutRow key={item.spotId} item={item} />
        ))}
      </ul>
    );
  }
  if (data.failedTxs.length === 0) return <EmptyState icon={CheckCircle2} title="no failed transactions this week" />;
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {data.failedTxs.map((tx) => (
        <li key={tx.id} className="flex items-center gap-3 px-4 py-3 text-small">
          <span className="w-36 shrink-0 font-mono">{tx.op}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{tx.error ?? "unknown error"}</span>
          <span className="shrink-0 text-subtle">{new Date(tx.updatedAt).toLocaleString()}</span>
          {tx.signature && <Address value={tx.signature} kind="tx" className="text-subtle" />}
        </li>
      ))}
    </ul>
  );
}

function PayoutRow({ item }: { item: ReviewSummary["payoutsReady"][number] }) {
  const queryClient = useQueryClient();
  const tx = useTx(() => api.spots.payout(item.spotId));
  const pay = async () => {
    if (await tx.execute()) await queryClient.invalidateQueries({ queryKey: queryKeys.reviewSummary });
  };
  return (
    <li className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-body">
          {item.listingTitle} · spot {item.spotIndex + 1} · <Money value={item.amount} className="font-semibold" />
        </p>
        <Button size="sm" onClick={() => void pay()} loading={tx.busy}>
          pay out
        </Button>
      </div>
      <TxStatus state={tx.state} action="payout" onRetry={tx.retry} />
    </li>
  );
}
