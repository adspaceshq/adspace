'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'motion/react'
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
          : `${spot.label}, ${formatMoney(spot.bid || spot.price, listing.currency)}`
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
          <span className="font-mono text-sm font-bold text-[#020817]">{formatMoney(spot.bid || spot.price, listing.currency)}</span>
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

export default function SpecSheet({ listing, onClaim, onBid, onPlaceSpot, onMoveSpot, onResizeSpot, onRemoveSpot, onSelectSpot, onDismissSpotPanel, selectedSpotId, spotPanel, activeViewId, onActiveViewChange, hideTabs, hideFooter }: {
  listing: Listing
  onClaim: (spot: Spot) => void
  onBid: (spot: Spot) => void
  hideFooter?: boolean
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
  /** Seller editor: click/tap anywhere outside the open panel (or Escape) to close it. */
  onDismissSpotPanel?: () => void
  /** Seller editor: the sticker currently being priced — drawn with a ring so the panel's target is obvious. */
  selectedSpotId?: string | null
  /** Seller editor: panel content (e.g. the price form) rendered right next to the selected sticker. */
  spotPanel?: ReactNode
  /** Controlled tab: when set, the Mac shows this view (parent drives it, e.g. row click jumps to the sticker's view). */
  activeViewId?: string | null
  /** Fires when the buyer/seller switches tabs, so the parent can stay in sync. */
  onActiveViewChange?: (viewId: string) => void
  /** Hide the built-in Lid/Inside tabs (the parent renders its own toolbar tabs instead). */
  hideTabs?: boolean
}) {
  const views = listing.mockup?.views || []
  const [internalIdx, setInternalIdx] = useState(0)
  // A parent-provided view wins; otherwise the local tab state rules. Setter keeps both in sync.
  const propIdx = activeViewId ? views.findIndex((v) => v.id === activeViewId) : -1
  const activeIdx = propIdx >= 0 ? propIdx : internalIdx
  const setActiveIdx = (i: number) => {
    setInternalIdx(i)
    const id = views[i]?.id
    if (id) onActiveViewChange?.(id)
  }
  const photoRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const stickerRefs = useRef(new Map<string, HTMLDivElement>())
  // Timestamp until which bare-photo clicks only close. A dismissing press that
  // drags off the photo never clicks, so a boolean flag could linger and eat the
  // next real placement — an expiry can't go stale.
  const suppressPlaceUntilRef = useRef(0)
  // sx/sy mark where the press started: a press that barely moves is a tap (select), not a drag.
  const dragRef = useRef<{ id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean } | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const resizeRef = useRef<string | null>(null)
  const [resizingId, setResizingId] = useState<string | null>(null)

  // Outside-click (or Escape) closes the open price panel. Presses inside the panel
  // or on the selected sticker itself are left alone so pricing, dragging, and the
  // sticker's own dots keep working. Lives above the empty-views return so the hook
  // order never changes.
  const panelOpen = !!onPlaceSpot && !!(views[activeIdx] || views[0])?.spots && !!spotPanel && !!selectedSpotId
  useEffect(() => {
    if (!panelOpen || !onDismissSpotPanel) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (target && panelRef.current?.contains(target)) return
      const selected = selectedSpotId ? stickerRefs.current.get(selectedSpotId) : undefined
      if (target && selected?.contains(target)) return
      if (target && photoRef.current?.contains(target)) suppressPlaceUntilRef.current = Date.now() + 400
      onDismissSpotPanel()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismissSpotPanel()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [panelOpen, selectedSpotId, onDismissSpotPanel])

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
  const claimedOnView = listing.spots.filter((s) => (listing.priceType === 'auction' ? s.bidBy : s.claimedBy) && viewSpotIds.includes(s.id)).length
  // An empty view has no count to report — in the seller's own preview, point at the editor instead.
  // The creator never needs a claimed count (nothing can be claimed before publishing), so it only
  // shows on buyer pages; the seller preview leaves that corner empty.
  const footerNote = !viewSpotIds.length
    ? (onPlaceSpot ? 'CLICK THE PHOTO TO ADD A SPOT' : '')
    : onPlaceSpot
      ? ''
      : `${claimedOnView}/${viewSpotIds.length} ${listing.priceType === 'auction' ? 'WITH BIDS' : 'CLAIMED'}`

  return (
    <div className="w-full">
      {views.length > 1 && !hideTabs && (
        <div className="mb-4 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Product views">
          {views.map((v, i) => (
            <button
              key={v.id}
              type="button"
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
            <span>{footerNote}</span>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex min-h-[320px] items-center justify-center">
            <div ref={photoRef} className="relative inline-block leading-[0]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={active.photo}
                alt={`${listing.title} — ${active.label}`}
                className="block h-auto max-h-[680px] w-auto max-w-full rounded-2xl"
              />
              {/* Tee base color: multiplied over the white flat art, masked to the
                  shirt silhouette so the backdrop stays clean. No tint on Mac views. */}
              {active.tint && active.photo && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-2xl"
                  style={{
                    background: active.tint,
                    mixBlendMode: 'multiply',
                    WebkitMaskImage: `url("${active.photo}")`,
                    maskImage: `url("${active.photo}")`,
                    WebkitMaskRepeat: 'no-repeat',
                    maskRepeat: 'no-repeat',
                    WebkitMaskPosition: 'center',
                    maskPosition: 'center',
                    WebkitMaskSize: 'contain',
                    maskSize: 'contain',
                  }}
                />
              )}
              {/* Seller editor: a transparent sibling *behind* the stickers, so a press on bare photo
                  drops a spot there while a press that lands on a sticker still reaches the sticker. */}
              {editing && (
                <button
                  type="button"
                  aria-label={`Add a spot on the ${active.label}`}
                  onClick={(e) => {
                    // A dismissing click never places: the pointerdown already closed the
                    // panel, so swallow this click instead of dropping a surprise sticker.
                    if (Date.now() < suppressPlaceUntilRef.current) return
                    // Keyboard "clicks" carry no coordinates — fall back to the top-centre slot.
                    const p = e.clientX || e.clientY ? pointFromPointer(e) : null
                    onPlaceSpot?.(p?.x ?? 50, p?.y ?? 20, active.id)
                  }}
                  className="absolute inset-0 z-[1] cursor-crosshair rounded-2xl"
                />
              )}
              <AnimatePresence>
                {spots.map((spot) => {
                  const isClaimed = !!spot.claimedBy
                  const isWinning = !isClaimed && !!spot.bidBy
                  const taken = isClaimed || isWinning
                  const who = isClaimed ? spot.claimedBy : spot.bidBy
                  const amount = spot.bid ?? spot.price
                  const price = spot.bid != null
                    ? formatMoney(spot.bid, listing.currency)
                    : listing.priceType === 'auction'
                      ? `from ${formatMoney(amount, listing.currency)}`
                      : formatMoney(amount, listing.currency)
                  // Center the *sticker* on its point — not the sticker-plus-caption column — so the
                  // top-row slots sit fully on the lid instead of hanging off the photo's top edge.
                  return (
                    <motion.div
                      key={spot.id}
                      initial={{ scale: 0, opacity: 0, x: '-50%', y: '-50%' }}
                      animate={{ scale: 1, opacity: 1, x: '-50%', y: '-50%' }}
                      exit={{ scale: 0, opacity: 0, x: '-50%', y: '-50%' }}
                      transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                      className={`absolute ${
                        editing && (draggingId === spot.id || resizingId === spot.id) ? 'z-[5]' : 'z-[2]'
                      }`}
                      style={{ left: `${spot.x}%`, top: `${spot.y}%`, width: `${spot.w}%` }}
                    >
                    {/* Wrapper exists so the handles can hug the sticker instead of the caption under it.
                        It is also the hover group that reveals the remove dot. */}
                    <div
                      className="group relative w-full"
                      ref={(el) => {
                        if (el) stickerRefs.current.set(spot.id, el)
                        else stickerRefs.current.delete(spot.id)
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (editing) return
                          if (listing.priceType === 'auction') {
                            if (!spot.sold) onBid(spot)
                          } else if (!taken) onClaim(spot)
                        }}
                        onPointerDown={editing ? (e) => {
                          const p = pointFromPointer(e)
                          if (!p) return
                          // Remember where the sticker was grabbed, so it moves with the cursor instead of jumping to it.
                          dragRef.current = { id: spot.id, dx: spot.x - p.x, dy: spot.y - p.y, sx: p.x, sy: p.y, moved: false }
                          setDraggingId(spot.id)
                          e.currentTarget.setPointerCapture(e.pointerId)
                        } : undefined}
                        onPointerMove={editing ? (e) => {
                          const drag = dragRef.current
                          if (!drag || drag.id !== spot.id) return
                          const p = pointFromPointer(e)
                          if (!p) return
                          // Ignore sub-pixel jitter: only real movement turns the press into a drag.
                          if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 1.5) return
                          drag.moved = true
                          onMoveSpot?.(spot.id, p.x + drag.dx, p.y + drag.dy)
                        } : undefined}
                        onPointerUp={editing ? (e) => {
                          if (dragRef.current?.id !== spot.id) return
                          // A press that never became a drag is a tap — select the sticker for pricing.
                          if (!dragRef.current.moved) onSelectSpot?.(spot.id)
                          dragRef.current = null
                          setDraggingId(null)
                          e.currentTarget.releasePointerCapture(e.pointerId)
                        } : undefined}
                        onKeyDown={editing ? (e) => {
                          // Delete (or Backspace, which is the key Macs label Delete) drops the spot.
                          if (canRemove && (e.key === 'Delete' || e.key === 'Backspace')) {
                            e.preventDefault()
                            onRemoveSpot?.(spot.id)
                            return
                          }
                          // Arrow keys nudge; hold shift for bigger steps. Clamping happens in gearPhotoView.
                          const step = e.shiftKey ? 5 : 1.5
                          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
                          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
                          if (!dx && !dy) return
                          e.preventDefault()
                          onMoveSpot?.(spot.id, spot.x + dx, spot.y + dy)
                        } : undefined}
                        aria-label={
                          editing
                            ? `${spot.label} — drag or arrow-key to move it${canRemove ? ', Delete to remove it' : ''}`
                            : isClaimed
                              ? `${spot.label} claimed by ${spot.claimedBy}`
                              : isWinning
                                ? `${spot.label}, top bid ${formatMoney(amount, listing.currency)} by ${spot.bidBy}`
                                : `${spot.label}, ${formatMoney(amount, listing.currency)}`
                        }
                        className={`relative flex aspect-square w-full flex-col items-center justify-center gap-[3px] rounded-xl px-1 py-2 font-mono leading-normal transition ${
                          taken && (listing.priceType !== 'auction' || spot.sold)
                            ? 'text-white shadow-[0_6px_18px_rgba(0,0,0,0.28)]'
                            : 'border-[1.5px] border-dashed border-[#94a3b8] text-[#020817] hover:z-[3] hover:border-[#4166fb] hover:shadow-[0_8px_24px_rgba(65,102,251,0.28)]'
                        } ${taken && spot.logoImage ? 'overflow-hidden p-0' : ''} ${
                          editing
                            ? `touch-none select-none ${draggingId === spot.id ? 'cursor-grabbing scale-[1.06] ring-2 ring-[#4166fb]' : 'cursor-grab'} ${selectedSpotId === spot.id ? 'ring-2 ring-[#4166fb]' : ''}`
                            : taken && (listing.priceType !== 'auction' || spot.sold)
                              ? 'cursor-default'
                              : 'cursor-pointer hover:scale-[1.06]'
                        }`}
                        style={taken && !spot.logoImage ? { background: spot.logoColor || '#3b82f6' } : undefined}
                      >
                        {taken ? (
                          spot.logoImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={spot.logoImage} alt={`${who} logo`} className="absolute inset-0 h-full w-full object-cover" />
                          ) : (
                            <>
                              <span className="text-[16px] font-bold leading-none">{(who ?? '?').charAt(0).toUpperCase()}</span>
                              <span className="w-full truncate px-1 text-center text-[10px] font-medium leading-tight">{who}</span>
                            </>
                          )
                        ) : (
                          <>
                            <span className="text-[13px] font-bold leading-none tracking-wide">
                              {spot.bid != null ? 'BID' : 'OPEN'}
                            </span>
                            <span className="text-[9px] font-medium uppercase leading-none tracking-[0.08em] text-[#64748b]">
                              {editing
                                ? (spot.bid != null ? 'top bid' : 'open')
                                : (spot.bid != null ? 'tap to outbid' : 'tap to bid')}
                            </span>
                          </>
                        )}
                      </button>
                      {canResize && (
                        <button
                          type="button"
                          aria-label={`Resize ${spot.label} — drag the handle or use the arrow keys, double-click to reset`}
                          onPointerDown={(e) => {
                            resizeRef.current = spot.id
                            setResizingId(spot.id)
                            e.currentTarget.setPointerCapture(e.pointerId)
                          }}
                          onPointerMove={(e) => {
                            if (resizeRef.current !== spot.id) return
                            const p = pointFromPointer(e)
                            // The handle rides the sticker's right edge, so the width is twice the centre-to-pointer run.
                            if (p) onResizeSpot?.(spot.id, clampStickerWidth(2 * (p.x - spot.x)))
                          }}
                          onPointerUp={(e) => {
                            if (resizeRef.current !== spot.id) return
                            resizeRef.current = null
                            setResizingId(null)
                            e.currentTarget.releasePointerCapture(e.pointerId)
                          }}
                          onKeyDown={(e) => {
                            // Arrow keys widen/narrow from the current width; shift for bigger steps.
                            const step = e.shiftKey ? 4 : 1.5
                            const dw = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
                            if (!dw) return
                            e.preventDefault()
                            onResizeSpot?.(spot.id, clampStickerWidth(spot.w + dw))
                          }}
                          onDoubleClick={() => onResizeSpot?.(spot.id, null)}
                          className={`${dotBase} -bottom-1.5 -right-1.5 cursor-nwse-resize hover:bg-[#e9edfe] ${
                            resizingId === spot.id ? 'scale-125 ring-2 ring-[#4166fb]' : ''
                          }`}
                        />
                      )}
                      {canRemove && (
                        <button
                          type="button"
                          aria-label={`Remove ${spot.label} from the ${active.label}`}
                          onClick={() => onRemoveSpot?.(spot.id)}
                          // Hover-revealed so the photo reads clean, and always on for touch, where there is no hover.
                          className={`${dotBase} -right-1.5 -top-1.5 pointer-events-none grid cursor-pointer place-items-center text-[#dc2626] opacity-0 hover:bg-[#fef2f2] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 pointer-coarse:pointer-events-auto pointer-coarse:opacity-100`}
                        >
                          <X size={8} strokeWidth={3} />
                        </button>
                      )}
                    </div>
                    {/* Caption hangs below the sticker out of flow, so it never shifts the sticker off its point. */}
                    <span className="absolute left-0 top-full mt-[6px] w-full text-center">
                      <span className="block truncate text-[13px] font-semibold leading-tight">{spot.label}</span>
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={amount > 0 ? `price-${amount}` : 'no-price'}
                          initial={{ opacity: 0, y: -3, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 3, scale: 0.95 }}
                          transition={{ duration: 0.15 }}
                          className="block truncate font-mono text-[12px] leading-tight text-[#64748b]"
                        >
                          {amount > 0 ? (
                            <span className="font-semibold text-[#020817]">{price}</span>
                          ) : (
                            'No price yet'
                          )}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                  </motion.div>
                )
              })}
              </AnimatePresence>
              {/* Seller editor: the price panel rides next to the sticker that opened it, so it
                  follows the sticker when it's dragged and lives on the same photo view. */}
              <AnimatePresence>
                {editing && spotPanel && selectedSpotId && (() => {
                  const sel = spots.find((s) => s.id === selectedSpotId)
                  if (!sel) return null
                  // Sit right of the sticker, flipped left when it's on the right half of the photo,
                  // and vertically clamped, so the panel never spills off the photo.
                  const flipX = sel.x > 55
                  return (
                    <motion.div
                      key={`panel-${selectedSpotId}`}
                      initial={{ opacity: 0, scale: 0.9, y: 6 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: 4 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                      className="absolute z-[6] w-[240px] leading-normal"
                      ref={panelRef}
                      style={{
                        left: `${sel.x + (flipX ? -sel.w / 2 : sel.w / 2)}%`,
                        top: `${Math.min(Math.max(sel.y, 18), 82)}%`,
                        transform: `translate(${flipX ? 'calc(-100% - 12px)' : '12px'}, -50%)`,
                      }}
                    >
                      {spotPanel}
                    </motion.div>
                  )
                })()}
              </AnimatePresence>
            </div>
          </div>
          {!hideFooter && (
            <div className="mt-3 flex items-center justify-between font-mono text-[11px] tracking-[0.06em] text-[#64748b]">
              <span className="font-semibold text-[#020817]">{active.label.toUpperCase()}</span>
              <span>{footerNote}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
