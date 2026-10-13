import { safeHref } from "@/lib/safe-href";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { fetchSponsoredSpot } from "@/lib/api/server";
import { listingHref, SURFACE_LABELS } from "@/lib/listing-display";
import { spotsOnView, spotView } from "@/lib/spot-views";

type Params = Promise<{ handle: string; listing: string; index: string }>;

const clean = (value: string) => decodeURIComponent(value).trim().replace(/^@+/, "").toLowerCase();
// URLs count spots from 1, like the UI.
const spotIndex = (value: string) => Number(value) - 1;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { listing: slug, index } = await params;
  const data = await fetchSponsoredSpot(slug, spotIndex(index));
  if (!data) return { title: "spot not found" };
  const title = `${data.brand.name} sponsored @${data.listing.seller.handle}'s ${SURFACE_LABELS[data.listing.surface].toLowerCase()}`;
  const description = `spot ${data.spot.index + 1} on "${data.listing.title}". ad space on anything people see, paid in USDC escrow.`;
  return { title, description, openGraph: { title, description }, robots: { index: false } };
}

export default async function SponsoredSpotPage({ params }: { params: Params }) {
  const { handle, listing: slug, index } = await params;
  const data = await fetchSponsoredSpot(slug, spotIndex(index));
  if (!data) notFound();
  const { listing, brand, spot } = data;
  if (clean(handle) !== listing.seller.handle.toLowerCase()) permanentRedirect(`${listingHref(listing.seller.handle, listing.slug)}/sponsored/${spot.index + 1}`);
  // Show the photo the sponsored spot sits on, with the other spots on that photo.
  const placed = listing.spots.find((item) => item.id === spot.id);
  const view = placed ? spotView(placed.layout, listing.photos.length) : 0;
  const cover = listing.photos[view]?.url;

  return (
    <AppShell variant="public">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <p className="text-caption font-medium uppercase tracking-wide text-subtle">sponsored spot</p>
        <h1 className="text-title font-semibold leading-tight sm:text-display">
          {brand.name} sponsored @{listing.seller.handle}&apos;s {SURFACE_LABELS[listing.surface].toLowerCase()}
        </h1>
        {cover && (
          <SpotMockup
            photoUrl={cover}
            alt={listing.title}
            spots={spotsOnView(listing.spots, view, listing.photos.length).map((item) => ({
              id: item.id,
              index: item.index,
              layout: item.layout,
              state: item.state,
              ...(item.id === spot.id && brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
            }))}
            selectedId={spot.id}
          />
        )}
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-surface p-4">
          <Link href={`/${listing.seller.handle}`} className="flex items-center gap-3">
            <SellerAvatar seller={listing.seller} size={40} />
            <div>
              <p className="text-body font-semibold">{listing.title}</p>
              <p className="text-small text-muted">
                spot {spot.index + 1} · @{listing.seller.handle}
                {brand.handle ? ` · sponsored by @${brand.handle}` : ""}
              </p>
            </div>
          </Link>
          <div className="flex gap-2">
            {brand.link && (
              <a href={safeHref(brand.link)} target="_blank" rel="noreferrer nofollow sponsored" className="rounded-control border border-line px-4 py-2 text-small font-medium hover:border-line-strong">
                visit {brand.name}
              </a>
            )}
            <Link href={listingHref(listing.seller.handle, listing.slug)} className="rounded-control bg-ink px-4 py-2 text-small font-medium text-white hover:bg-ink/90">
              see the listing
            </Link>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
