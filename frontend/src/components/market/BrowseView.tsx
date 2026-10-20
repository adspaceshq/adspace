"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Search, SearchX, Store } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { BrowseFilters, BrowsePage } from "@/lib/api/types";
import { BROWSE_PAGE_SIZE, BROWSE_SORTS, BROWSE_SURFACES, readBrowseFilters } from "@/lib/browse-filters";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { cx } from "@/lib/cx";
import { Button, buttonClasses } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListingCard, ListingCardSkeleton } from "./ListingCard";

const PAGE_SIZE = BROWSE_PAGE_SIZE;
const SURFACES = BROWSE_SURFACES;
const SORTS = BROWSE_SORTS;

const sameFilters = (a: BrowseFilters, b: BrowseFilters) => a.q === b.q && a.surface === b.surface && a.mode === b.mode && a.sort === b.sort;

// `initialPage`: page 1 rendered on the server, for the filters it was fetched with.
export function BrowseView({ initialPage }: { initialPage?: { filters: BrowseFilters; page: BrowsePage } }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const filters = readBrowseFilters(params);
  const [search, setSearch] = useState(filters.q ?? "");

  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };

  // Debounce typing into the URL so every keystroke doesn't hit the API.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((filters.q ?? "") !== search.trim()) setFilter("q", search.trim() || undefined);
    }, 300);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to typing
  }, [search]);

  const query = useInfiniteQuery({
    queryKey: queryKeys.listings(filters as Record<string, unknown>),
    queryFn: ({ pageParam }) => api.listings.published({ ...filters, limit: PAGE_SIZE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.hasMore ? pages.length * PAGE_SIZE : undefined),
    // Used only while the URL still matches what the server rendered.
    initialData: initialPage && sameFilters(initialPage.filters, filters) ? { pages: [initialPage.page], pageParams: [0] } : undefined,
    // Server data is up to 30s old; refresh it in the background after hydration.
    initialDataUpdatedAt: 0,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = Boolean(filters.q || filters.surface || filters.mode);

  const chip = (active: boolean) =>
    cx(
      "h-9 shrink-0 cursor-pointer rounded-full border px-4 text-small font-medium transition-colors",
      active ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:border-line-strong",
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-title font-semibold sm:text-display">find space people actually see</h1>
        <p className="max-w-2xl text-body text-muted">
          laptops at conferences, cars across cities, bags through airports. pay in USDC, held in escrow until it&apos;s delivered.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <label className="relative block">
          <span className="sr-only">search</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="search creators, events, cities"
            className="h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 text-body placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
          />
        </label>
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto pb-1">
          <button type="button" className={chip(!filters.surface)} onClick={() => setFilter("surface", undefined)}>
            all
          </button>
          {SURFACES.map((surface) => (
            <button
              key={surface}
              type="button"
              aria-pressed={filters.surface === surface}
              className={chip(filters.surface === surface)}
              onClick={() => setFilter("surface", filters.surface === surface ? undefined : surface)}
            >
              {SURFACE_LABELS[surface]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1 rounded-full border border-line bg-surface p-1" role="group" aria-label="pricing">
            {[
              { value: undefined, label: "all" },
              { value: "fixed", label: "fixed price" },
              { value: "auction", label: "auctions" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={filters.mode === option.value}
                onClick={() => setFilter("mode", option.value)}
                className={cx(
                  "h-7 cursor-pointer rounded-full px-3 text-small font-medium",
                  filters.mode === option.value ? "bg-ink text-white" : "text-muted hover:text-ink",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-small text-muted">
            sort
            <select
              value={filters.sort}
              onChange={(event) => setFilter("sort", event.target.value === "closing" ? undefined : event.target.value)}
              className="h-9 cursor-pointer rounded-control border border-line bg-surface px-3 text-small text-ink focus:border-accent focus:outline-none"
            >
              {SORTS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {query.isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="couldn't load spaces"
          description="check your connection and try again."
          action={<Button onClick={() => void query.refetch()}>try again</Button>}
        />
      ) : query.isPending ? (
        <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" role="status" aria-label="loading spaces">
          {Array.from({ length: 8 }, (_, index) => (
            <ListingCardSkeleton key={index} />
          ))}
        </div>
      ) : items.length === 0 && filtered ? (
        <EmptyState
          icon={SearchX}
          title="no spaces match"
          description="try a different surface or search term."
          action={
            <Button variant="secondary" onClick={() => router.replace(pathname)}>
              clear filters
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Store}
          title="nothing listed yet"
          description="be the first. put a sponsor's logo on your laptop, car or shopfront: sponsors pay in usdc, held in escrow until you post proof."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Link href="/sell" className={buttonClasses()}>
                list your space
              </Link>
              <a href="https://adspaces.fun/#how" className="text-body font-medium text-accent hover:underline">
                how it works
              </a>
            </div>
          }
        />
      ) : (
        <>
          <div className="grid gap-x-4 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
          {query.hasNextPage && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
