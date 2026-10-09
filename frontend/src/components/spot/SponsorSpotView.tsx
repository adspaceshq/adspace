"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, BadgeCheck, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/v2";
import { listingHref, profileHref } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { useNow } from "@/lib/use-now";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { ShareSpotButton } from "./ShareSpotButton";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { MessagesPanel } from "./MessagesPanel";
import { SponsorActions } from "./SponsorActions";
import { SpotActivity } from "./SpotActivity";

export function SponsorSpotView({ spotId }: { spotId: string }) {
  const now = useNow(15_000);
  const query = useQuery({ queryKey: queryKeys.spot(spotId), queryFn: () => api.spots.detail(spotId), refetchInterval: 30_000 });

  if (query.isPending) {
    return (
      <SkeletonGroup label="loading spot">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="aspect-[4/3] w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title={query.error.message}
        description="this spot is only visible to its sponsor, its creator and the adspaces team."
        action={
          <Link href="/dashboard/sponsor" className="text-body font-medium text-accent hover:underline">
            back to your spots
          </Link>
        }
      />
    );
  }

  const detail = query.data;
  const { spot, listing, seller } = detail;
  const photo = listing.photos[0]?.url;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/sponsor" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> your spots
      </Link>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8">
          <div className="flex flex-col gap-2">
            <p className="text-small text-muted">
              spot {spot.index + 1}
              {spot.label && ` · ${spot.label}`}
            </p>
            <h1 className="text-title font-semibold">{listing.title}</h1>
            <Link href={profileHref(seller.handle)} className="flex items-center gap-2 self-start text-body text-muted hover:text-ink">
              <SellerAvatar seller={seller} size={24} />
              @{seller.handle}
              {seller.verified && <BadgeCheck className="size-4 text-accent" aria-label="verified" />}
            </Link>
            {detail.role === "sponsor" && (
              <ShareSpotButton handle={seller.handle} slug={listing.slug} index={spot.index} state={spot.state} brandName={spot.brand?.name} />
            )}
          </div>
          {photo && (
            <SpotMockup
              photoUrl={photo}
              alt={listing.title}
              selectedId={spot.id}
              spots={[{ id: spot.id, index: spot.index, layout: spot.layout, state: "open", logoUrl: spot.brand?.logoUrl }]}
            />
          )}
          {spot.brand && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line bg-surface px-4 py-3 text-small">
              <span className="text-muted">your brand</span>
              <span className="font-semibold">{spot.brand.name}</span>
              {spot.brand.handle && <span className="text-muted">@{spot.brand.handle}</span>}
              {spot.brand.link && (
                <a href={spot.brand.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  {new URL(spot.brand.link).hostname} <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          )}
          {detail.proofPosts.length > 0 && (
            <section aria-labelledby="proof" className="flex flex-col gap-3">
              <h2 id="proof" className="text-lead font-semibold">
                proof of delivery
              </h2>
              <ul className="flex flex-col gap-2">
                {detail.proofPosts.map((post) => (
                  <li key={post.id} className="rounded-card border border-line bg-surface px-4 py-3">
                    {post.body && <p className="whitespace-pre-line text-body">{post.body}</p>}
                    {post.url && (
                      <a href={post.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-small font-medium text-accent hover:underline">
                        open post <ExternalLink className="size-3" aria-hidden />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
              <Link href={listingHref(seller.handle, listing.slug)} className="self-start text-small text-accent hover:underline">
                see all updates and views on the listing
              </Link>
            </section>
          )}
          <section aria-labelledby="activity" className="flex flex-col gap-3">
            <h2 id="activity" className="text-lead font-semibold">
              activity
            </h2>
            <SpotActivity spotId={spot.id} />
          </section>
          <MessagesPanel spotId={spot.id} counterpart={`@${seller.handle}`} />
        </div>
        <aside className="order-first flex flex-col gap-4 lg:order-none lg:sticky lg:top-24 lg:self-start">
          {detail.role === "sponsor" ? (
            <SponsorActions detail={detail} now={now} />
          ) : (
            <div className="rounded-panel border border-line bg-surface p-5 text-small text-muted shadow-card">
              you&apos;re viewing this spot as the {detail.role}.
              {detail.role === "creator" && (
                <Link
                  href={`/sell/listings/${listing.id}`}
                  className="mt-3 flex h-10 w-full items-center justify-center rounded-control border border-line bg-surface text-body font-medium text-ink hover:border-line-strong"
                >
                  open in your control room
                </Link>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
