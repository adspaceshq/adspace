"use client";

import { Bookmark } from "lucide-react";
import Link from "next/link";
import { useWatchlist } from "@/lib/use-watchlist";
import { useNow } from "@/lib/use-now";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListingCard, ListingCardSkeleton } from "@/components/market/ListingCard";

export function WatchlistView() {
  const { items, isPending } = useWatchlist();
  const now = useNow(60_000);
  const live = (items ?? []).filter((item) => item.listing.state === "published" && new Date(item.listing.deadline).getTime() > now);
  const ended = (items ?? []).filter((item) => !live.includes(item));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title font-semibold sm:text-display">saved</h1>
        <p className="text-body text-muted">listings you&apos;re keeping an eye on, soonest closing first.</p>
      </div>
      {isPending ? (
        <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((key) => (
            <ListingCardSkeleton key={key} />
          ))}
        </div>
      ) : !items?.length ? (
        <EmptyState
          icon={Bookmark}
          title="nothing saved yet"
          description="tap the bookmark on any listing to keep it here."
          action={
            <Link href="/browse" className="text-body font-medium text-accent hover:underline">
              browse listings
            </Link>
          }
        />
      ) : (
        <>
          {live.length > 0 && (
            <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {[...live]
                .sort((a, b) => Date.parse(a.listing.deadline) - Date.parse(b.listing.deadline))
                .map((item) => (
                  <ListingCard key={item.listing.id} listing={item.listing} />
                ))}
            </div>
          )}
          {ended.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="text-body font-semibold text-muted">ended</h2>
              <div className="grid gap-x-4 gap-y-8 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
                {ended.map((item) => (
                  <ListingCard key={item.listing.id} listing={item.listing} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
