'use client'

import { useRef, useState, type ReactNode } from 'react'
import { Apple, X } from 'lucide-react'
import { formatMoney, clampStickerWidth, lidPointFromPointer, type GridCell, type Listing, type Spot } from '@/lib/listings'

/*
 * Spec sheets. Two view kinds:
 * - grid: a BrandMyMac-style lid grid — dashed cells around a center logo.
 * - photo: a product photo with stickers at percent coordinates.
 */

type StickerSpot = Spot & { x: number; y: number; w: number }

function GridCellView({ cell, listing, onClaim, onBid }: {
  cell: GridCell
  listing: Listing
  onClaim: (spot: Spot) => void
  onBid: (spot: Spot) => void
}) {
  if (cell.logo) {
    return (
      <div className="flex items-center justify-center py-6">
        <Apple size={110} className="text-[#2b2f36]" strokeWidth={1.4} />
      </div>
    )
  }
  const spot = listing.spots.find((s) => s.id === cell.spot)
  if (!spot) return null
  const isClaimed = !!spot.claimedBy
  return (
    <button
      type="button"
      onClick={() => {
        if (isClaimed) return
        if (listing.priceType === 'auction') onBid(spot)
        else onClaim(spot)
      }}
      aria-label={
        isClaimed
          ? `${spot.label} claimed by ${spot.claimedBy}`
          : `${spot.label}, ${spot.size}, ${formatMoney(spot.bid || spot.price, listing.currency)}`
      }
      className={`flex min-h-[120px] flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-[#9aa0aa] bg-[#ececee] p-4 text-center transition sm:min-h-[150px] ${
        isClaimed ? 'cursor-default' : 'cursor-pointer hover:border-[#4166fb] hover:bg-white hover:shadow-[0_8px_24px_rgba(65,102,251,0.2)]'
      }`}
      style={{ gridColumn: `span ${cell.span} / span ${cell.span}` }}
    >
      {isClaimed ? (
        <>
          <span
            className="grid h-11 w-11 place-items-center rounded-xl text-lg font-bold text-white"
            style={{ background: spot.logoColor || '#3b82f6' }}
          >
            {spot.claimedBy!.charAt(0)}
          </span>
          <span className="font-[family-name:var(--font-body)] text-[15px] font-semibold text-[#020817]">
            {spot.claimedBy}
          </span>
          <span className="font-mono text-sm text-[#64748b]">{formatMoney(spot.bid ?? spot.price, listing.currency)}</span>
        </>
      ) : (
        <>
          <span className="font-mono text-xs font-bold tracking-wide text-[#020817]">{spot.size}</span>
          <span className="font-mono text-sm text-[#020817]">{formatMoney(spot.bid || spot.price, listing.currency)}</span>
          <span className="font-mono text-[11px] text-[#64748b]">
            {spot.bid ? 'top bid · tap to outbid' : 'open · tap to bid'}
          </span>
        </>
      )}
    </button>
  )
}

/*
 * Sticker corner handles. A small dot with a big grab area: the ::before box widens
 * the hit target without adding ink, so the photo still reads as a clean mockup.
 */
const dotBase =
  "absolute h-3 w-3 touch-none select-none rounded-full border border-[#020817] bg-white shadow-[0_1px_3px_rgba(2,8,23,0.3)] transition before:absolute before:-inset-2 before:content-[''] hover:scale-125"

export default function SpecSheet({ listing, onClaim, onBid, onPlaceSpot, onMoveSpot, onResizeSpot, onRemoveSpot, onSelectSpot, selectedSpotId, spotPanel }: {
  listing: Listing
  onClaim: (spot: Spot) => void
  onBid: (spot: Spot) => void
  /** Seller editor: click bare photo to drop a spot where you clicked, on that view. */
  onPlaceSpot?: (x: number, y: number, viewId: string) => void
  /** Seller editor: drag a sticker, or nudge it with the arrow keys, to move it. */
  onMoveSpot?: (spotId: string, x: number, y: number) => void
  /** Seller editor: drag a sticker's corner handle, or use the arrow keys on it, to resize it. `null` = back to auto. */
  onResizeSpot?: (spotId: string, w: number | null) => void
  /** Seller editor: drop a spot from the preview. The spot rows above stay in sync; the last spot stays. */
  onRemoveSpot?: (spotId: string) => void
  /** Seller editor: tap a sticker (press without dragging) to select it — opens the price panel. */
  onSelectSpot?: (spotId: string) => void
  /** Seller editor: the sticker currently being priced — drawn with a ring so the panel's target is obvious. */
  selectedSpotId?: string | null
  /** Seller editor: panel content (e.g. the price form) rendered right next to the selected sticker. */
  spotPanel?: ReactNode
}) {
  const views = listing.mockup?.views || []
  const [activeIdx, setActiveIdx] = useState(0)
  const photoRef = useRef<HTMLDivElement | null>(null)
  // sx/sy mark where the press started: a press that barely moves is a tap (select), not a drag.
  const dragRef = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const resizeRef = useRef<string | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)

  if (!views.length) return null
  const active = views[activeIdx] || views[0]

  // Hand-placed stickers only ever exist in the seller's own preview, never on a buyer's page.
  // A `spots` list is what marks a sticker surface: the lid and the deck both carry one, and a photo
  // view without one (a listing's own Overview image) stays read-only. Coordinates are % of whichever
  // photo is on screen, so the view id travels back with the click — each view keeps its own layout.
  const editing = !!onPlaceSpot && !!active.spots
  // Resizing shares the sticker's corner handle; a preview can offer it without click-to-place.
  const canResize = !!onResizeSpot
  // Removing mirrors the row button on /list: offered only while more than one spot remains.
  const canRemove = !!onRemoveSpot && listing.spots.length > 1
  const pointFromPointer = (e: { clientX: number; clientY: number }) => {
    const rect = photoRef.current?.getBoundingClientRect()
    return rect ? lidPointFromPointer(rect, e.clientX, e.clientY) : null
  }

  const spots: StickerSpot[] = (active.spots || [])
    .map((pos) => {
      const data = listing.spots.find((s) => s.id === pos.id)
      return data ? { ...data, x: pos.x, y: pos.y, w: pos.w } : null
    })
    .filter((s): s is StickerSpot => s !== null)

  const viewSpotIds = active.grid
    ? active.grid.flat().map((c) => c.spot).filter(Boolean)
    : spots.map((s) => s.id)
  const claimedOnView = listing.spots.filter((s) => s.claimedBy && viewSpotIds.includes(s.id)).length
  // An empty view has no count to report — in the seller's preview, point at the editor instead.
  const footerNote = viewSpotIds.length
    ? `${claimedOnView}/${viewSpotIds.length} CLAIMED`
    : onPlaceSpot
      ? 'CLICK THE PHOTO TO ADD A SPOT'
      : ''

  return (
    <div className="w-full">
      {views.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Product views">
          {views.map((v, i) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={i === activeIdx}
              onClick={() => setActiveIdx(i)}
              className={`rounded-full border px-[14px] py-[6px] font-mono text-xs font-medium transition ${
                i === activeIdx
                  ? 'border-[#020817] bg-[#020817] text-white'
                  : 'border-[#e7e5e0] bg-white text-[#64748b] hover:border-[#c3cdfd] hover:text-[#020817]'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {active.grid ? (
        <div className="rounded-[28px] bg-[#e3e4e8] p-4 sm:p-6">
          <div className="flex flex-col gap-4">
            {active.grid.map((row, r) => (
              <div key={r} className="grid grid-cols-12 gap-4">
                {row.map((cell, c) => (
                  <GridCellView
                    key={cell.spot ?? `logo-${c}`}
                    cell={cell}
                    listing={listing}
                    onClaim={onClaim}
                    onBid={onBid}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between px-1 font-mono text-[11px] tracking-[0.06em] text-[#64748b]">
            <span className="font-semibold text-[#020817]">{active.label.toUpperCase()}</span>
            <span>
              {claimedOnView}/{viewSpotIds.length} CLAIMED
            </span>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-3xl border border-[#e7e5e0] bg-white p-4 sm:p-8">
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'linear-gradient(rgba(199,199,199,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(199,199,199,0.45) 1px, transparent 1px)',
              backgroundSize: '24px 24px',
            }}
          />
          <div className="relative z-10 flex min-h-[320px] items-center justify-center">
            <div className="relative inline-block leading-[0]">
              <img
                src={active.photo}
                alt={`${listing.title} — ${active.label}`}
                className="block h-auto max-h-[520px] w-auto max-w-full"
              />
              {spots.map((spot) => {
                const isClaimed = !!spot.claimedBy
                const isWinning = !isClaimed && !!spot.bidBy
                return (
                  <button
                    key={spot.id}
                    onClick={() => {
                      if (isClaimed) return
                      if (listing.priceType === 'auction') onBid(spot)
                      else onClaim(spot)
                    }}
                    aria-label={
                      isClaimed
                        ? `${spot.label} claimed by ${spot.claimedBy}`
                        : isWinning
                          ? `${spot.label}, top bid ${formatMoney(spot.bid ?? spot.price, listing.currency)} by ${spot.bidBy}`
                          : `${spot.label}, ${spot.size}, ${formatMoney(spot.bid || spot.price, listing.currency)}`
                    }
                    className={`absolute z-[2] flex min-h-[46px] min-w-[46px] max-w-[180px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-[1px] rounded-[10px] px-2 py-[6px] font-mono leading-normal transition ${
                      isClaimed || isWinning
                        ? 'cursor-default text-white shadow-[0_6px_18px_rgba(0,0,0,0.28)]'
                        : 'cursor-pointer border-[1.5px] border-dashed border-[#94a3b8] bg-transparent text-[#020817] hover:z-[3] hover:scale-[1.07] hover:border-[#4166fb] hover:bg-white/40 hover:shadow-[0_8px_24px_rgba(65,102,251,0.28)]'
                    }`}
                    style={{
                      left: `${spot.x}%`,
                      top: `${spot.y}%`,
                      width: `${spot.w}%`,
                      ...((isClaimed || isWinning) ? { background: spot.logoColor || '#3b82f6' } : {}),
                    }}
                  >
                    {isClaimed || isWinning ? (
                      <>
                        <span className="text-center text-xs font-bold leading-tight">{isClaimed ? spot.claimedBy : spot.bidBy}</span>
                        <span className="text-[10px] font-medium opacity-90">{formatMoney(spot.bid ?? spot.price, listing.currency)}</span>
                      </>
                    ) : (
                      <>
                        <span className="text-[11px] font-bold tracking-wide">{spot.size}</span>
                        <span className="text-[10px] font-medium">{formatMoney(spot.bid || spot.price, listing.currency)}</span>
                      </>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between font-mono text-[11px] tracking-[0.06em] text-[#64748b]">
            <span className="font-semibold text-[#020817]">{active.label.toUpperCase()}</span>
            <span>
              {claimedOnView}/{viewSpotIds.length} CLAIMED
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
