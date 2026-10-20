"use client";

import { safeHref } from "@/lib/safe-href";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, BadgeCheck, ExternalLink, MailCheck, ShieldCheck } from "lucide-react";
import type { SpotState } from "@/lib/api/types";
import { api } from "@/lib/api/v2";
import { isNotFound, userErrorMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { listingHref, profileHref } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { useNow } from "@/lib/use-now";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SpotMockup } from "@/components/ui/SpotMockup";
import { spotView } from "@/lib/spot-views";
import { ShareSpotButton } from "./ShareSpotButton";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { MessagesPanel } from "./MessagesPanel";
import { SponsorActions } from "./SponsorActions";
import { DisputeEvidence } from "./DisputeEvidence";
import { SpotActivity } from "./SpotActivity";
import { XHandleLink } from "@/components/ui/UserLink";
import { Address } from "@/components/ui/Address";
import { Money } from "@/components/ui/Money";

// States where the spot's USDC still sits in its vault.
const ESCROW_HELD: SpotState[] = ["funded", "delivered", "disputed"];

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
    const status = (query.error as { status?: number }).status;
    const hidden = status === 403 || isNotFound(query.error);
    return (
      <EmptyState
        icon={AlertTriangle}
        title={hidden ? "you can't see this spot" : "couldn't load this spot"}
        description={
          hidden ? "this spot is only visible to its sponsor, its creator and the adspaces team." : userErrorMessage(query.error)
        }
        action={
          hidden ? (
            <Link href="/dashboard/sponsor" className="text-body font-medium text-accent hover:underline">
              back to your spots
            </Link>
          ) : (
            <Button variant="secondary" onClick={() => void query.refetch()}>
              try again
            </Button>
          )
        }
      />
    );
  }

  const detail = query.data;
  const { spot, listing, seller } = detail;
  // The photo this spot sits on (the cover unless the seller placed it on another photo).
  const photo = listing.photos[spotView(spot.layout, listing.photos.length)]?.url;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/dashboard/sponsor" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> your spots
      </Link>
      {detail.role === "sponsor" && <VerifyEmailNote />}
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
              {spot.brand.handle && <XHandleLink handle={spot.brand.handle} className="text-muted" />}
              {spot.brand.link && (
                <a href={safeHref(spot.brand.link)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                  {hostnameOf(spot.brand.link)} <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
          )}
          {spot.vaultAddress && spot.amount && ESCROW_HELD.includes(spot.state) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-surface px-4 py-3 text-small">
              <ShieldCheck className="size-4 text-success" aria-hidden />
              <span>
                <Money value={spot.amount} /> held in escrow on Solana
              </span>
              <Address value={spot.vaultAddress} className="text-muted" />
            </div>
          )}
          {detail.dispute && (
            <section aria-labelledby="dispute" className="flex flex-col gap-3">
              <h2 id="dispute" className="text-lead font-semibold">
                {detail.dispute.state === "open" ? "dispute" : "last dispute"}
              </h2>
              <DisputeEvidence dispute={detail.dispute} proofPosts={detail.proofPosts} headingLevel="h3" />
            </section>
          )}
          {!detail.dispute && detail.proofPosts.length > 0 && (
            <section aria-labelledby="proof" className="flex flex-col gap-3">
              <h2 id="proof" className="text-lead font-semibold">
                proof of delivery
              </h2>
              <ul className="flex flex-col gap-2">
                {detail.proofPosts.map((post) => (
                  <li key={post.id} className="rounded-card border border-line bg-surface px-4 py-3">
                    {post.body && <p className="whitespace-pre-line text-body">{post.body}</p>}
                    {post.url && (
                      <a href={safeHref(post.url)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-small font-medium text-accent hover:underline">
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
        <aside className="order-first flex flex-col gap-4 lg:order-none lg:sticky lg:top-20 lg:self-start">
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

// A stored link that doesn't parse shouldn't take the page down.
function hostnameOf(link: string): string {
  try {
    return new URL(link).hostname;
  } catch {
    return link;
  }
}

// The page no longer waits for setup, so sponsors without a verified email are nudged here instead:
// that's where outbid, proof and dispute emails go.
function VerifyEmailNote() {
  const { session, linkEmail, linkError } = useSession();
  if (!session || session.emailVerified) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3">
      <MailCheck className="size-5 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1 text-small text-muted">
        <span className="font-medium text-ink">verify your email</span> so we can tell you when proof is posted or something needs you.
        {linkError && <span className="block text-danger">{linkError}</span>}
      </p>
      <Button size="sm" variant="secondary" onClick={() => void linkEmail()}>
        verify email
      </Button>
    </div>
  );
}
