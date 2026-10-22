"use client";

import { safeHref } from "@/lib/safe-href";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { usePaused } from "@/lib/use-status";
import { BadgeCheck, MapPin, Share2, Users } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { PublicListing, PublicSpot } from "@/lib/api/types";
import { canPurchase, minimumNextBid } from "@/lib/bids";
import { formatFollowers, profileHref, SURFACE_LABELS } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { useNow } from "@/lib/use-now";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Countdown } from "@/components/ui/Countdown";
import { Money } from "@/components/ui/Money";
import { SpotPhotos } from "@/components/ui/SpotPhotos";
import { spotView, viewLabel } from "@/lib/spot-views";
import { SpotStateBadge } from "@/components/ui/StateBadge";
import { CheckoutModal } from "./CheckoutModal";
import { BidHistory } from "./BidHistory";
import { ListingTimeline } from "./ListingTimeline";
import { PostFeed } from "./PostFeed";
import { WatchButton } from "@/components/watchlist/WatchButton";
import { SellerAvatar } from "./SellerAvatar";
import { UserLink, XHandleLink } from "@/components/ui/UserLink";
import { PENDING_CHECKOUT } from "@/lib/first-run";

// Remembers which spot a signed-out visitor chose, so checkout reopens after sign-in (Privy's OAuth
// logins can reload the page, so component state alone would be lost).
function savePendingCheckout(value: { slug: string; spotId: string } | null) {
  try {
    if (value) sessionStorage.setItem(PENDING_CHECKOUT, JSON.stringify({ ...value, at: Date.now() }));
    else sessionStorage.removeItem(PENDING_CHECKOUT);
  } catch {
    // Storage blocked (private mode): the visitor just clicks claim again after signing in.
  }
}
function readPendingCheckout(slug: string): string | undefined {
  try {
    const raw = sessionStorage.getItem(PENDING_CHECKOUT);
    if (!raw) return undefined;
    const value = JSON.parse(raw) as { slug?: string; spotId?: string; at?: number };
    // Only for this listing, and only for a sign-in that just happened.
    if (value.slug !== slug || !value.spotId || Date.now() - (value.at ?? 0) > 15 * 60_000) return undefined;
    return value.spotId;
  } catch {
    return undefined;
  }
}

// The API refuses a bid from the current top bidder; the panel and the mobile bar both say so instead.
// Shares BidHistory's query (same key), so this costs no extra request.
function useYouLead(listing: PublicListing, spot: PublicSpot, available: boolean) {
  const bidQuery = useQuery({
    queryKey: ["bids", spot.id],
    queryFn: () => api.spots.bids(spot.id),
    enabled: listing.mode === "auction" && spot.state === "funded",
    refetchInterval: available ? 30_000 : false,
  });
  return Boolean(bidQuery.data?.items[0]?.isYou && bidQuery.data.items[0].isTop);
}

export function ListingView({ initial }: { initial: PublicListing }) {
  const { ready, session, signIn } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const paused = usePaused();
  const now = useNow(10_000);
  const live = initial.state === "published" && new Date(initial.deadline).getTime() > now;
  // Live auctions move fast; refresh bids every few seconds while the tab is visible.
  const { data: listing = initial } = useQuery({
    queryKey: queryKeys.listing(initial.slug),
    queryFn: () => api.listings.bySlug(initial.slug),
    initialData: initial,
    refetchInterval: live && initial.mode === "auction" ? 5_000 : 30_000,
    refetchIntervalInBackground: false,
  });

  const firstAvailable = listing.spots.find((spot) => canPurchase(listing, spot, now)) ?? listing.spots[0];
  const [selectedId, setSelectedId] = useState(firstAvailable?.id);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const selected = listing.spots.find((spot) => spot.id === selectedId) ?? firstAvailable;
  const isOwner = session?.id === listing.sellerId;

  const startCheckout = () => {
    if (!session) {
      if (selected) savePendingCheckout({ slug: listing.slug, spotId: selected.id });
      return signIn();
    }
    setCheckoutOpen(true);
  };

  // Back from sign-in: reopen checkout on the spot they picked, if it can still be bought.
  const sessionId = session?.id;
  useEffect(() => {
    if (!ready || !sessionId) return;
    const pending = readPendingCheckout(listing.slug);
    if (!pending) return;
    savePendingCheckout(null);
    const spot = listing.spots.find((item) => item.id === pending);
    if (!spot || listing.sellerId === sessionId || !canPurchase(listing, spot, Date.now())) return;
    // Bid history marks "you" per session: refresh it now that we know who this is, then open
    // checkout (so a returning top bidder sees "you're leading" rather than a bid form).
    let active = true;
    void queryClient.invalidateQueries({ queryKey: ["bids", spot.id] }).finally(() => {
      if (!active) return;
      setSelectedId(spot.id);
      setCheckoutOpen(true);
    });
    return () => {
      active = false;
    };
  }, [ready, sessionId, listing, queryClient]);

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) await navigator.share({ title: listing.title, url }).catch(() => undefined);
    else {
      try {
        await navigator.clipboard.writeText(url);
        toast.success("link copied");
      } catch {
        toast.error("couldn't copy the link", url);
      }
    }
  };

  const scrollToPanel = () => document.getElementById("buy")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div className="grid gap-8 pb-24 lg:grid-cols-[minmax(0,1fr)_360px] lg:pb-0">
      <div className="flex min-w-0 flex-col gap-8">
        <SpotPhotos
          photos={listing.photos.map((photo) => ({ url: photo.url }))}
          alt={listing.title}
          selectedId={selected?.id}
          onSelect={setSelectedId}
          spots={listing.spots.map((spot) => ({
            id: spot.id,
            index: spot.index,
            layout: spot.layout,
            state: spot.state,
            price: spot.price,
            label: spot.label,
            logoUrl: spot.brand?.logoUrl,
          }))}
        />

        {/* Small screens get the whole purchase panel inline (bid history, top-bidder state, escrow line);
            the fixed bar below is a shortcut to it. Desktop shows the same panel in the sidebar. */}
        {selected && (
          <div id="buy" className="scroll-mt-20 lg:hidden">
            <PurchasePanel listing={listing} spot={selected} isOwner={isOwner} paused={paused} now={now} onPurchase={startCheckout} />
          </div>
        )}

        <SpotList listing={listing} selectedId={selected?.id} onSelect={setSelectedId} now={now} />

        {listing.description && (
          <section aria-labelledby="about" className="flex flex-col gap-2">
            <h2 id="about" className="text-lead font-semibold">
              about this space
            </h2>
            <p className="whitespace-pre-line text-body text-muted">{listing.description}</p>
          </section>
        )}

        <section aria-labelledby="timeline" className="flex flex-col gap-3">
          <h2 id="timeline" className="text-lead font-semibold">
            how it plays out
          </h2>
          <ListingTimeline listing={listing} now={now} />
        </section>

        <PostFeed listingId={listing.id} spots={listing.spots} />
      </div>

      <aside className="order-first flex flex-col gap-4 lg:order-none lg:sticky lg:top-20 lg:self-start">
        <SellerCard listing={listing} onShare={() => void share()} />
        {selected && (
          <PurchasePanel
            listing={listing}
            spot={selected}
            isOwner={isOwner}
            paused={paused}
            now={now}
            onPurchase={startCheckout}
            className="hidden lg:flex"
          />
        )}
      </aside>

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-md lg:hidden">
          <MobilePurchaseBar
            listing={listing}
            spot={selected}
            isOwner={isOwner}
            paused={paused}
            now={now}
            onPurchase={startCheckout}
            onShowDetails={scrollToPanel}
          />
        </div>
      )}

      {selected && checkoutOpen && (
        <CheckoutModal listing={listing} spot={selected} open={checkoutOpen} onClose={() => setCheckoutOpen(false)} />
      )}
    </div>
  );
}

function SellerCard({ listing, onShare }: { listing: PublicListing; onShare: () => void }) {
  const followers = formatFollowers(listing.audience.followers);
  const place = listing.audience.event ?? listing.audience.location;
  return (
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card">
      <div className="flex items-center gap-3">
        <SellerAvatar seller={listing.seller} size={44} />
        <div className="min-w-0 flex-1">
          <Link href={profileHref(listing.seller.handle)} className="flex items-center gap-1 font-semibold hover:underline">
            <span className="truncate">{listing.seller.displayName}</span>
            {listing.seller.verified && <BadgeCheck className="size-4 shrink-0 text-accent" aria-label="verified" />}
          </Link>
          <p className="truncate text-small text-muted">
            <UserLink handle={listing.seller.handle} />
          </p>
        </div>
        <WatchButton listingId={listing.id} sellerId={listing.seller.id} className="shadow-none" />
        <button type="button" onClick={onShare} aria-label="share listing" className="cursor-pointer rounded-full p-2 text-muted hover:bg-ink/5 hover:text-ink">
          <Share2 className="size-4" />
        </button>
      </div>
      <div>
        <p className="text-caption font-medium uppercase tracking-wide text-subtle">{SURFACE_LABELS[listing.surface]}</p>
        <h1 className="mt-1 text-title font-semibold leading-tight">{listing.title}</h1>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted">
        {followers && (
          <span className="inline-flex items-center gap-1">
            <Users className="size-3.5" aria-hidden /> {followers} followers
          </span>
        )}
        {place && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden /> {place}
          </span>
        )}
      </div>
      <p className="text-body">
        <Countdown to={listing.deadline} prefix={listing.mode === "auction" ? "bidding closes in" : "claims close in"} className="font-medium" />
      </p>
    </div>
  );
}

function spotHeadline(listing: PublicListing, spot: PublicSpot) {
  if (listing.mode === "auction") {
    return spot.amount
      ? { label: "current bid", amount: spot.amount, next: minimumNextBid(listing, spot).toString() }
      : { label: "starting bid", amount: spot.price, next: spot.price };
  }
  return { label: "price", amount: spot.price, next: spot.price };
}

function PurchasePanel({
  listing,
  spot,
  isOwner,
  paused,
  now,
  onPurchase,
  className,
}: {
  listing: PublicListing;
  spot: PublicSpot;
  isOwner: boolean;
  paused: boolean;
  now: number;
  onPurchase: () => void;
  className?: string;
}) {
  const available = canPurchase(listing, spot, now);
  const youLead = useYouLead(listing, spot, available);
  const headline = spotHeadline(listing, spot);
  return (
    <div className={cx("flex flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card", className)}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-lead font-semibold">
          spot {spot.index + 1}
          {spot.label && <span className="font-normal text-muted"> · {spot.label}</span>}
        </p>
        <SpotStateBadge state={spot.state} bidding={listing.mode === "auction" && canPurchase(listing, spot, now)} />
      </div>
      {spot.brand && <SponsorLine brand={spot.brand} sponsor={spot.sponsor ?? undefined} leading={listing.mode === "auction" && spot.state === "funded"} />}
      <div>
        <p className="text-small text-muted">{headline.label}</p>
        <p className="text-display font-semibold leading-none">
          <Money value={headline.amount} />
        </p>
        {listing.mode === "auction" && spot.amount && available && (
          <p className="mt-1 text-small text-muted">
            next bid at least <Money value={headline.next} />
            {listing.doubleUp && " (each bid must double the last)"}
          </p>
        )}
      </div>
      {isOwner ? (
        <p className="rounded-control bg-canvas px-3 py-2 text-small text-muted">
          this is your listing.{" "}
          <Link href={`/sell/listings/${listing.id}`} className="font-medium text-accent hover:underline">
            open control room
          </Link>
        </p>
      ) : youLead && available ? (
        <p className="rounded-control bg-success-soft px-3 py-2 text-small text-ink">
          you&apos;re the top bidder. we&apos;ll let you know if someone outbids you.
        </p>
      ) : (
        <>
          <Button size="lg" onClick={onPurchase} disabled={!available || paused} aria-describedby={paused && available ? "paused-note" : undefined}>
            {!available ? "not available" : paused ? "trading is paused" : listing.mode === "auction" ? "place a bid" : "claim this spot"}
          </Button>
          {paused && available && (
            <p id="paused-note" className="-mt-2 text-small text-muted">
              claims and bids are paused for now. payouts, refunds and disputes still work.
            </p>
          )}
        </>
      )}
      <p className="text-small text-muted">
        your USDC is held in escrow until delivery is proven. no fees for sponsors.
      </p>
      {listing.mode === "auction" && <BidHistory spotId={spot.id} live={available} />}
    </div>
  );
}

function MobilePurchaseBar({
  listing,
  spot,
  isOwner,
  paused,
  now,
  onPurchase,
  onShowDetails,
}: {
  listing: PublicListing;
  spot: PublicSpot;
  isOwner: boolean;
  paused: boolean;
  now: number;
  onPurchase: () => void;
  onShowDetails: () => void;
}) {
  const available = canPurchase(listing, spot, now);
  const youLead = useYouLead(listing, spot, available);
  const headline = spotHeadline(listing, spot);
  return (
    <div className="mx-auto flex max-w-xl items-center gap-4">
      <button type="button" onClick={onShowDetails} aria-label={`spot ${spot.index + 1} details`} className="min-w-0 flex-1 cursor-pointer text-left">
        <span className="block truncate text-small text-muted">
          spot {spot.index + 1} · {headline.label}
        </span>
        <span className="block text-lead font-semibold">
          <Money value={headline.amount} />
        </span>
      </button>
      {isOwner ? (
        <Link href={`/sell/listings/${listing.id}`} className="text-small font-medium text-accent hover:underline">
          your listing · control room
        </Link>
      ) : youLead && available ? (
        <span className="rounded-full bg-success-soft px-3 py-1.5 text-small font-medium text-ink">you&apos;re leading</span>
      ) : (
        <Button onClick={onPurchase} disabled={!available || paused}>
          {!available ? "not available" : paused ? "paused" : listing.mode === "auction" ? "bid" : "claim"}
        </Button>
      )}
    </div>
  );
}

function SpotList({ listing, selectedId, onSelect, now }: { listing: PublicListing; selectedId?: string; onSelect: (id: string) => void; now: number }) {
  // When spots sit on more than one photo, say which photo each is on.
  const photoCount = listing.photos.length;
  const spread = listing.spots.some((spot) => spotView(spot.layout, photoCount) > 0);
  return (
    <section aria-labelledby="spots" className="flex flex-col gap-3">
      <h2 id="spots" className="text-lead font-semibold">
        spots
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {listing.spots.map((spot) => {
          const selected = spot.id === selectedId;
          const headline = spotHeadline(listing, spot);
          return (
            <li key={spot.id}>
              <button
                type="button"
                onClick={() => onSelect(spot.id)}
                aria-pressed={selected}
                className={cx(
                  "flex w-full cursor-pointer items-center gap-3 rounded-card border px-4 py-3 text-left transition-colors",
                  selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-control bg-ink/5 font-mono text-small font-semibold">
                  {spot.brand?.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- small sponsor logo
                    <img src={spot.brand.logoUrl} alt="" className="size-full bg-white object-contain p-0.5" />
                  ) : (
                    spot.index + 1
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{spot.label || `spot ${spot.index + 1}`}</span>
                  {spot.brand && (
                    <span className="block truncate text-small text-muted">
                      sponsored by {spot.brand.name}
                      {spot.sponsor && (
                        <>
                          {" · "}
                          <UserLink handle={spot.sponsor.handle} nested />
                        </>
                      )}
                    </span>
                  )}
                  <span className="text-small text-muted">
                    {headline.label} <Money value={headline.amount} />
                    {spread && ` · ${viewLabel(spotView(spot.layout, photoCount))}`}
                  </span>
                </span>
                <SpotStateBadge state={spot.state} bidding={listing.mode === "auction" && canPurchase(listing, spot, now)} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// Who holds a sold spot (or leads an auction), linked to their site when they gave one.
function SponsorLine({
  brand,
  sponsor,
  leading,
}: {
  brand: NonNullable<PublicListing["spots"][number]["brand"]>;
  sponsor?: { handle: string };
  leading: boolean;
}) {
  const name = brand.link ? (
    <a href={safeHref(brand.link)} target="_blank" rel="noreferrer nofollow sponsored" className="font-medium text-ink hover:underline">
      {brand.name}
    </a>
  ) : (
    <span className="font-medium text-ink">{brand.name}</span>
  );
  return (
    <div className="flex items-center gap-3 rounded-card bg-canvas p-3">
      {brand.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- sponsor logo
        <img src={brand.logoUrl} alt="" className="size-10 shrink-0 rounded-control border border-line bg-white object-contain p-1" />
      )}
      <p className="text-small text-muted">
        {leading ? "top bid by " : "sponsored by "}
        {name}
        {sponsor && (
          <span>
            {" · on adspaces "}
            <UserLink handle={sponsor.handle} />
          </span>
        )}
        {brand.handle && (
          <span>
            {" · "}
            <XHandleLink handle={brand.handle} />
          </span>
        )}
      </p>
    </div>
  );
}
