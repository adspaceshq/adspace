import { WatchButton } from "@/components/watchlist/WatchButton";
import Link from "next/link";
import { BadgeCheck, MapPin, Users } from "lucide-react";
import type { PublicListing } from "@/lib/api/types";
import { formatFollowers, listingHref, priceSummary, spotsLeft, SURFACE_LABELS } from "@/lib/listing-display";
import { Countdown } from "@/components/ui/Countdown";
import { Money } from "@/components/ui/Money";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { SellerAvatar } from "./SellerAvatar";
import { UserLink } from "@/components/ui/UserLink";

export function ListingCard({ listing }: { listing: PublicListing }) {
  const price = priceSummary(listing);
  const left = spotsLeft(listing);
  const followers = formatFollowers(listing.audience.followers);
  const place = listing.audience.event ?? listing.audience.location;
  const cover = listing.photos[0]?.url;
  return (
    <div className="relative">
    <Link
      href={listingHref(listing.seller.handle, listing.slug)}
      className="group flex flex-col gap-3 rounded-panel p-2 transition-colors hover:bg-surface focus-visible:bg-surface"
    >
      {cover ? (
        <SpotMockup
          photoUrl={cover}
          alt={listing.title}
          size="thumb"
          spots={listing.spots.map((spot) => ({ id: spot.id, index: spot.index, layout: spot.layout, state: spot.state, logoUrl: spot.brand?.logoUrl }))}
          className="transition-transform group-hover:scale-[1.01]"
        />
      ) : (
        <div className="aspect-[4/3] rounded-card bg-ink/5" />
      )}
      <div className="flex flex-col gap-1.5 px-1 pb-1">
        <div className="flex items-center gap-2 text-small text-muted">
          <SellerAvatar seller={listing.seller} size={20} />
          <UserLink handle={listing.seller.handle} nested className="truncate" />
          {listing.seller.verified && <BadgeCheck className="size-3.5 shrink-0 text-accent" aria-label="verified" />}
          <span className="ml-auto shrink-0">{SURFACE_LABELS[listing.surface]}</span>
        </div>
        <h3 className="line-clamp-2 text-lead font-semibold leading-snug">{listing.title}</h3>
        {(followers || place) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-muted">
            {followers && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden /> {followers}
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" aria-hidden /> {place}
              </span>
            )}
          </div>
        )}
        <div className="mt-1 flex items-end justify-between gap-3">
          {price ? (
            <p className="text-body">
              <span className="text-muted">{price.label} </span>
              <Money value={price.amount} className="font-semibold" />
            </p>
          ) : (
            <p className="text-body text-muted">all spots taken</p>
          )}
          <div className="text-right text-small">
            <p className="text-muted">
              {left} spot{left === 1 ? "" : "s"} left
            </p>
            <Countdown to={listing.deadline} prefix="closes in" className="font-medium" />
          </div>
        </div>
      </div>
    </Link>
    <WatchButton listingId={listing.id} sellerId={listing.seller.id} className="absolute right-4 top-4" />
    </div>
  );
}

export function ListingCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 p-2" aria-hidden>
      <div className="aspect-[4/3] animate-pulse rounded-card bg-ink/5" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-ink/5" />
      <div className="h-5 w-4/5 animate-pulse rounded bg-ink/5" />
      <div className="h-4 w-1/3 animate-pulse rounded bg-ink/5" />
    </div>
  );
}
