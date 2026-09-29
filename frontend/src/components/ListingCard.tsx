'use client'

import { cardPhoto, formatMoney, isEnded, sellerDisplay, spotOversubscription, surfaceLabels, type Listing } from '@/lib/listings'
import SellerAvatar from '@/components/SellerAvatar'

function SpotProgress({ spots, auction }: { spots: Listing['spots']; auction: boolean }) {
  const claimed = spots.filter((s) => auction ? !!s.bidBy : !!s.claimedBy).length
  const pct = spots.length ? Math.round((claimed / spots.length) * 100) : 0
  return (
    <div className="mt-auto flex items-center gap-3">
      <div className="h-[6px] flex-1 overflow-hidden rounded-full bg-[#f1f0ec]">
        <div className="h-full rounded-full bg-[#4166fb] transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="whitespace-nowrap text-xs text-[#64748b]">
        {claimed}/{spots.length} {auction ? 'with bids' : 'claimed'}
      </span>
    </div>
  )
}

const badgeStyles: Record<string, string> = {
  live: 'bg-[#d1fae5] text-[#065f46]',
  auction: 'bg-[#e9edfe] text-[#4166fb]',
  closed: 'bg-[#f1f0ec] text-[#64748b]',
}

export default function ListingCard({ listing }: { listing: Listing }) {
  const isAuction = listing.priceType === 'auction'
  const claimedCount = listing.spots.filter((s) => isAuction ? !!s.bidBy : !!s.claimedBy).length
  const soldOut = claimedCount === listing.spots.length
  const minPrice = Math.min(...listing.spots.map((s) => s.price))
  const badge = soldOut ? 'closed' : isAuction ? 'auction' : 'live'
  const photo = cardPhoto(listing)
  const oversubscribed = isAuction
    ? listing.spots.map(spotOversubscription).filter((percent) => percent > 0)
    : []
  const highestOversubscription = Math.max(0, ...oversubscribed)

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#e7e5e0] bg-white transition duration-200 hover:-translate-y-1 hover:border-[#c3cdfd] hover:shadow-[0_16px_40px_rgba(2,8,23,0.1)]">
      <div className="relative aspect-[16/10] bg-[#f1f0ec]">
        {photo ? (
          <img src={photo} alt={listing.title} loading="lazy" className="h-full w-full object-cover" />
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
        <span className={`absolute left-3 top-3 inline-flex items-center rounded-full px-3 py-[5px] font-mono text-[11px] font-medium uppercase tracking-wide shadow-sm ${badgeStyles[badge]}`}>
          {soldOut ? 'Sold out' : isAuction ? 'Live auction' : 'Live'}
        </span>
        {highestOversubscription > 0 && (
          <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-[#fff7ed] px-3 py-[5px] font-mono text-[11px] font-semibold uppercase tracking-wide text-[#9a3412] shadow-sm">
            {oversubscribed.length} hot · up to +{highestOversubscription}%
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-center justify-between">
          <span className="rounded-full bg-[#e9edfe] px-[10px] py-1 font-mono text-[11px] font-medium uppercase tracking-wide text-[#4166fb]">
            {surfaceLabels[listing.surface] ?? listing.surface}
          </span>
          <span className="text-[15px] font-semibold">
            {isAuction ? 'Bids from ' : 'From '}
            {formatMoney(minPrice, listing.currency)}
          </span>
        </div>
        <h3 className="font-display text-[22px] leading-tight">{listing.title}</h3>
        <p className="text-sm text-[#64748b]">{listing.goal}</p>
        <div className="flex items-center gap-2 text-sm">
          <SellerAvatar seller={listing.seller} className="h-[26px] w-[26px] text-xs" />
          <span className="truncate font-semibold">{sellerDisplay(listing.seller)}</span>
        </div>
        <SpotProgress spots={listing.spots} auction={isAuction} />
        <div className="flex justify-between border-t border-[#e7e5e0] pt-3 text-[13px] text-[#64748b]">
          <span>{isEnded(listing.endsAt) ? `Ended ${listing.deadline}` : `Ends ${listing.deadline}`}</span>
          <span className="font-semibold text-[#16a34a]">
            {soldOut ? (isAuction ? 'All have bids' : 'All claimed') : `${listing.spots.length - claimedCount} spots left`}
          </span>
        </div>
      </div>
    </article>
  )
}
