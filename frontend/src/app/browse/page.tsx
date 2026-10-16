import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { BrowseView } from "@/components/market/BrowseView";
import { fetchBrowseFirstPage } from "@/lib/api/server";
import { BROWSE_PAGE_SIZE, readBrowseFilters } from "@/lib/browse-filters";

export const metadata: Metadata = {
  title: "browse spaces",
  description: "Find ad space on laptops, cars, bags and more. Pay in USDC, held in escrow until delivery.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Page 1 for the URL's filters is fetched on the server (cached for 30 seconds); later pages and
// filter changes load in the browser.
export default async function BrowsePage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const filters = readBrowseFilters({ get: (key: string) => (typeof raw[key] === "string" ? (raw[key] as string) : null) });
  const firstPage = await fetchBrowseFirstPage(filters, BROWSE_PAGE_SIZE);
  return (
    <AppShell>
      <Suspense>
        <BrowseView initialPage={firstPage ? { filters, page: firstPage } : undefined} />
      </Suspense>
    </AppShell>
  );
}
