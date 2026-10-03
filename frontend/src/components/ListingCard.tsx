'use client'

import { Clock, Flame, Gavel } from 'lucide-react'
import {
  cardPhoto,
  formatMoney,
  isEnded,
  listingOversubscription,
  sellerDisplay,
  surfaceLabels,
  type Listing,
} from '@/lib/listings'
import SellerAvatar from '@/components/SellerAvatar'

export default function ListingCard({ listing }: { listing: Listing }) {
  const isAuction = listing.priceType === 'auction'
  const claimedCount = listing.spots.filter((s) => (isAuction ? !!s.bidBy : !!s.claimedBy)).length
  const soldOut = claimedCount === listing.spots.length
  const minPrice = Math.min(...listing.spots.map((s) => s.price))
  const photo = cardPhoto(listing)
  const demand = listingOversubscription(listing)

  return (
    <article className="group flex h-full flex-col transition duration-200">
      {/* Photo Preview Container (Unboxed) */}
      <div className="relative aspect-[16/10] overflow-hidden rounded-xl bg-[#e7e6e1]">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={listing.title}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-300 ease-out group-hover:scale-[1.02]"
          />
        ) : (
          <div
            aria-hidden="true"
            className="grid h-full w-full place-items-center"
            style={{ background: `linear-gradient(135deg, ${listing.seller.color}22, #e9edfe)` }}
          >
            <span className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">
              {surfaceLabels[listing.surface] ?? listing.surface}
            </span>
          </div>
        )}

        {/* Top Badges */}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
          {soldOut ? (
            <span className="inline-flex items-center rounded-md bg-zinc-900/80 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur">
              Sold out
            </span>
          ) : isAuction ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600/90 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-white shadow-xs backdrop-blur">
              <Gavel size={10} />
              Auction
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/95 px-2 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-emerald-700 shadow-xs backdrop-blur">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live
            </span>
          )}
        </div>

        {isAuction && demand.percent > 0 && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-[#fff7ed]/95 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[#9a3412] shadow-xs backdrop-blur">
            <Flame size={10} className="text-orange-600" />
            +{demand.percent}%
          </span>
        )}
      </div>

      {/* Content — Unboxed below photo */}
      <div className="flex flex-1 flex-col pt-3 pb-1">
        <div className="flex items-center justify-between text-xs">
          <span className="font-mono text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
            {surfaceLabels[listing.surface] ?? listing.surface}
          </span>
          <span className="font-mono text-[13px] font-medium text-[#020817]">
            <span className="font-sans text-[11px] text-[#64748b]">
              {isAuction ? 'Bids from ' : 'From '}
            </span>
            {formatMoney(minPrice, listing.currency)}
          </span>
        </div>

        <h3 className="mt-1 font-medium text-[16px] leading-snug text-[#020817] group-hover:text-[#4166fb] transition-colors line-clamp-1">
          {listing.title}
        </h3>

        <p className="mt-0.5 line-clamp-1 text-[13px] text-[#64748b]">{listing.goal}</p>

        <div className="mt-2.5 flex items-center justify-between text-xs pt-2 border-t border-[#e5e4de]/60">
          <div className="flex items-center gap-1.5">
            <SellerAvatar seller={listing.seller} className="h-4 w-4 text-[10px]" />
            <span className="truncate text-[12px] text-[#020817] font-medium">{sellerDisplay(listing.seller)}</span>
          </div>

          <span
            className={`font-mono text-[11px] ${
              soldOut ? 'text-zinc-400' : 'text-[#64748b]'
            }`}
          >
            {soldOut
              ? isAuction
                ? 'All bids placed'
                : 'All claimed'
              : `${listing.spots.length - claimedCount} spots left`}
          </span>
        </div>
      </div>
    </article>
  )
}
