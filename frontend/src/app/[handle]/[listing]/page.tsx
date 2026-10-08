import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { ListingView } from "@/components/market/ListingView";
import { fetchPublicListing } from "@/lib/api/server";
import { listingHref } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";

type Params = Promise<{ handle: string; listing: string }>;

const cleanHandle = (value: string) => decodeURIComponent(value).trim().replace(/^@+/, "").toLowerCase();

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { listing: slug } = await params;
  const listing = await fetchPublicListing(slug);
  if (!listing) return { title: "listing not found" };
  const open = listing.spots.filter((spot) => spot.state === "open");
  const from = open.length ? open.reduce((low, spot) => (BigInt(spot.price) < BigInt(low) ? spot.price : low), open[0].price) : null;
  const description = [
    `${listing.spots.length} ad spot${listing.spots.length === 1 ? "" : "s"} by @${listing.seller.handle}`,
    from ? `from ${formatUsd(from)}` : "all spots taken",
    listing.audience.event ?? listing.audience.location,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    title: listing.title,
    description,
    alternates: { canonical: listingHref(listing.seller.handle, listing.slug) },
    openGraph: { title: listing.title, description, url: listingHref(listing.seller.handle, listing.slug) },
  };
}

export default async function ListingPage({ params }: { params: Params }) {
  const { handle, listing: slug } = await params;
  const listing = await fetchPublicListing(slug);
  if (!listing) notFound();
  if (cleanHandle(handle) !== listing.seller.handle.toLowerCase()) {
    permanentRedirect(listingHref(listing.seller.handle, listing.slug));
  }
  return (
    <AppShell>
      <ListingView initial={listing} />
    </AppShell>
  );
}
