'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import Header from '@/components/Header'
import SpecSheet from '@/components/SpecSheet'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { INSIDE_VIEW_ID, LID_VIEW_ID, formatMoney, gearInsideView, gearPhotoView, sellerListings, sellerUrl, type LidPlacement, type Listing } from '@/lib/listings'
import { PRIVY_ENABLED } from '@/lib/privy'

const field =
  'w-full rounded-lg border border-[#e7e5e0] bg-white px-[14px] py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition focus:border-[#4166fb] focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none'

interface SpotDraft {
  label: string
  size: string
  price: string
  /* View the sticker lives on — the deck when set to 'inside'. Absent = the lid, where every spot starts. */
  view?: string
  /* Sticker position in % of that view's photo, set by clicking or dragging. Absent = auto-laid out. */
  x?: number
  y?: number
  /* Sticker width in % of that view's photo, set by dragging the corner handle. Absent = auto width. */
  w?: number
}

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const prettyDeadline = (input: string) => {
  const d = new Date(`${input}T12:00:00`)
  return Number.isNaN(d.getTime()) ? input : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ListPage() {
  const { listings, addListing } = useStore()
  const router = useRouter()

  const [sellerName, setSellerName] = useState('')
  const [title, setTitle] = useState('')
  const surface = 'gear'
  const [goal, setGoal] = useState('')
  const [deadline, setDeadline] = useState(() => toDateInput(new Date(Date.now() + 14 * 86_400_000)))
  const priceType = 'auction' as const
  const [spots, setSpots] = useState<SpotDraft[]>([{ label: '', size: '', price: '' }])
  // Id of the spot whose price panel is open — set by dropping or tapping a sticker.
  const [editingSpot, setEditingSpot] = useState<string | null>(null)
  // Which Mac view is on screen. Row clicks drive it so the Mac jumps to the tapped sticker's view.
  const [activeView, setActiveView] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Review gate: submitting the form (button or Enter) only opens the confirm dialog —
  // nothing goes live until "Go live" is clicked there.
  const [reviewing, setReviewing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [x, setX] = useState<XIdentity | null>(null)

  const updateSpot = (i: number, patch: Partial<SpotDraft>) =>
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // Live view of what buyers will see — rebuilt from the form on every keystroke.
  const preview: Listing = useMemo(() => {
    const pid = 'preview'
    const pspots = spots.map((s, i) => ({
      id: `${pid}-s${i + 1}`,
      label: s.label.trim() || `Spot ${i + 1}`,
      size: s.size.trim() || 'M',
      price: Number(s.price) || 0,
    }))
    // Stickers the seller placed or sized by hand; everything else auto-lays out. Each spot belongs to
    // one view, so the deck only ever draws the spots actually dropped on it.
    const lidIds: string[] = []
    const deckIds: string[] = []
    const lidPlaced: Record<string, LidPlacement> = {}
    const deckPlaced: Record<string, LidPlacement> = {}
    pspots.forEach((p, i) => {
      const draft = spots[i]
      const onDeck = draft.view === INSIDE_VIEW_ID
      const ids = onDeck ? deckIds : lidIds
      ids.push(p.id)
      if (draft.x != null || draft.y != null || draft.w != null) {
        const placed = onDeck ? deckPlaced : lidPlaced
        placed[p.id] = { x: draft.x, y: draft.y, w: draft.w }
      }
    })
    return {
      id: pid,
      title: title.trim() || 'Your listing',
      goal: '',
      description: '',
      image: '',
      surface,
      seller: { name: '', handle: '', color: '#4166fb' },
      deadline: '',
      endsAt: '',
      priceType,
      spots: pspots,
      // Lid first (the main sticker surface), then the deck. Each view draws only its own spots.
      mockup: { views: [gearPhotoView(lidIds, lidPlaced), gearInsideView(deckIds, deckPlaced)] },
    }
  }, [spots, title, surface, priceType])

  // A click on bare photo drops a spot there — on the view that was clicked — and opens
  // the side panel so the price is the next thing typed. Preview ids are positional: the new spot is last.
  const placeSpot = (x: number, y: number, viewId: string) => {
    setSpots((prev) => [...prev, { label: '', size: '', price: '', view: viewId, x, y }])
    setActiveView(viewId)
    setEditingSpot(`preview-s${spots.length + 1}`)
  }

  // Preview ids carry no index, so match the sticker back to its draft by position in the list.
  const moveSpot = (spotId: string, x: number, y: number) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0) return
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, x, y } : s)))
  }

  // Resize from the sticker's corner handle. `null` from a double-click drops back to the auto width.
  const resizeSpot = (spotId: string, w: number | null) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0) return
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, w: w ?? undefined } : s)))
  }

  // Remove from the sticker's dot (or Delete on a focused sticker). Keeps one spot. Removing shifts the
  // positional preview ids, so close the price panel rather than leave it pointing at the wrong spot.
  const removeSpot = (spotId: string) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0 || spots.length <= 1) return
    setEditingSpot(null)
    setSpots((prev) => prev.filter((_, j) => j !== i))
  }

  // Index of the spot the price panel is open for; -1 keeps the panel hidden.
  const editingIdx = editingSpot ? preview.spots.findIndex((p) => p.id === editingSpot) : -1

  // BrandMyMac-style summary strip: count · floor price · close date. Floor ignores
  // unpriced stickers so "from" always reflects a real starting bid.
  const priced = spots.map((s) => Number(s.price)).filter((p) => p > 0)
  const floor = priced.length ? Math.min(...priced) : 0
  const total = priced.reduce((a, b) => a + b, 0)
  const currency = preview.currency ?? 'USD'

  const addSticker = () => {
    if (spots.length >= 60) {
      setError('Max 60 spots per listing.')
      return
    }
    setSpots((prev) => [...prev, { label: '', size: '', price: '' }])
    setActiveView(LID_VIEW_ID)
    setEditingSpot(`preview-s${spots.length + 1}`)
  }

  // Row click jumps the Mac to that sticker: switch to its view (lid/inside), select it so the
  // price panel opens next to it, and bring the Mac into view on small screens.
  const focusSticker = (rowId: string, i: number) => {
    setEditingSpot(rowId)
    setActiveView(spots[i]?.view === INSIDE_VIEW_ID ? INSIDE_VIEW_ID : LID_VIEW_ID)
    document.getElementById('mac-preview')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  // Review gate: only the Publish CTA opens the confirm dialog — Enter anywhere
  // in the form (basics or the sticker popover) must not submit.
  const review = () => {
    // Seller: verified X session when Privy is configured, manual name in demo mode.
    // The API derives the seller from the session — the form never sends a name.
    if (PRIVY_ENABLED) {
      if (!x?.ready || x.loggingIn) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    const seller = PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()
    if (!seller || !title.trim() || spots.length === 0) {
      setError(
        PRIVY_ENABLED
          ? 'A title and at least one spot are required.'
          : 'Your name, a title and at least one spot are required.',
      )
      return
    }
    if (!deadline) {
      setError('Pick a deadline for the auction.')
      return
    }
    const prices = spots.map((s) => Number(s.price))
    if (prices.some((p) => !p || p <= 0)) {
      setError('Every spot needs a price above zero.')
      return
    }
    setError(null)
    setReviewing(true)
  }

  // Fired only from the review dialog's "Go live" button — this is the point of no return.
  const goLive = async () => {
    if (publishing) return
    setPublishing(true)
    const seller = PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()
    const id = `user-${Date.now()}`
    const spotIds = spots.map((_, i) => `${id}-s${i + 1}`)
    const onDeck = (i: number) => spots[i].view === INSIDE_VIEW_ID
    const listing: Listing = {
      id,
      title: title.trim(),
      goal: goal.trim() || 'Fund my goal',
      description: '',
      image: '',
      surface,
      seller: { name: seller, handle: PRIVY_ENABLED ? seller : '', color: '#4166fb' },
      deadline: prettyDeadline(deadline),
      endsAt: new Date(`${deadline}T23:59:00`).toISOString(),
      priceType,
      spots: spots.map((s, i) => ({
        id: `${id}-s${i + 1}`,
        label: s.label.trim() || `Spot ${i + 1}`,
        size: s.size.trim() || 'M',
        price: Number(s.price),
        view: onDeck(i) ? 'inside' : 'lid',
      })),
      mockup: {
        // The deck keeps the spots the seller dropped there; positions and sizes are preview-only, so
        // both views auto-lay out on publish (see the note under the preview).
        views: [
          gearPhotoView(spotIds.filter((_, i) => !onDeck(i))),
          gearInsideView(spotIds.filter((_, i) => onDeck(i))),
        ],
      },
    }
    try {
      await addListing(listing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish. Try again.')
      setReviewing(false)
      setPublishing(false)
      return
    }
    // New space goes live as the seller's newest — oldest-first it lands last,
    // so its short key is mac-N (or plain mac for their first).
    const existingCount = sellerListings(listings, seller).length
    const shortKey = existingCount === 0 ? 'mac' : `mac-${existingCount + 1}`
    router.push(`${sellerUrl(seller)}/${shortKey}`)
  }

  return (
    <>
      <Header />
      {PRIVY_ENABLED && <XProbe onChange={setX} />}
      <main className="mx-auto w-full max-w-[1240px] px-6 pb-16 pt-8">
        <div className="mb-6 text-center">
          <p className="mb-3 flex items-center justify-center gap-2 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#64748b]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
            Mac-only · auction · mock — no money moves
          </p>
          <h1 className="mb-2" style={{ fontSize: '40px' }}>List your Mac lid.</h1>
          <p className="text-[16px] text-[#64748b]">
            {spots.length} sticker{spots.length === 1 ? '' : 's'}
            {floor > 0 ? ` · from ${formatMoney(floor, currency)}` : ' · set a starting bid below'}
            {' '}· ends {prettyDeadline(deadline)}
          </p>
        </div>

        <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-8">
          <section className="mx-auto max-w-[640px]">
            <h2 className="mb-6 text-center text-[22px]">The basics</h2>
            <div className="mb-5 flex flex-col gap-[6px]">
              <span className="text-[13px] font-semibold">Surface</span>
              <p className="text-[15px] text-[#020817]">
                MacBook lid <span className="text-[#64748b]">· auction · only surface for now</span>
              </p>
            </div>
            {/* Seller identity comes from the X session — never a typed name — so there is
                no "Your name" field when Privy login is on. Demo mode (no Privy) keeps it. */}
            {PRIVY_ENABLED ? (
              !(x?.authenticated && x.handle) && (
                <div className="mb-5 flex flex-col gap-[6px]">
                  <p className="text-[14px] text-[#64748b]">Log in with X to list. Your handle becomes the seller.</p>
                  <button
                    type="button"
                    onClick={() => x?.login()}
                    disabled={!x?.ready || x?.loggingIn}
                    className="rounded-lg bg-[#020817] px-4 py-3 text-[15px] font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
                  >
                    {x?.loggingIn ? 'Redirecting to X…' : 'Log in with X to list'}
                  </button>
                  {x?.error && <p className="text-sm font-medium text-[#dc2626]">{x.error}</p>}
                </div>
              )
            ) : (
              <div className="mb-5 flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-name">Your name</label>
                <input id="list-name" className={field} placeholder="vana" value={sellerName} onChange={(e) => setSellerName(e.target.value)} required />
              </div>
            )}
            <div className="mb-5 flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-title">Title</label>
              <input id="list-title" className={field} placeholder="Put your brand on my MacBook lid" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-goal">Goal</label>
                <input id="list-goal" className={field} placeholder="Fund my MacBook" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-deadline">Deadline</label>
                <input id="list-deadline" type="date" className={field} value={deadline} min={toDateInput(new Date())} onChange={(e) => setDeadline(e.target.value)} required />
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-center text-[22px]">Stickers</h2>
            <p className="mx-auto mb-8 max-w-[560px] text-center text-[14px] text-[#64748b]">Click the lid to drop a sticker, or add one below. Tap a sticker to name and price it.</p>
            {/* One toolbar for the whole section: count left, Lid/Inside center, add right —
                so the row reads as a single line instead of two half-headers. */}
            <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-3">
              <span className="mr-auto font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#64748b]">
                {spots.length} sticker{spots.length === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2 max-sm:order-3 max-sm:w-full max-sm:justify-center" role="tablist" aria-label="Product views">
                {preview.mockup.views.map((v) => {
                  const selected = (activeView ?? LID_VIEW_ID) === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setActiveView(v.id)}
                      className={`rounded-full border px-[14px] py-[6px] font-mono text-xs font-medium transition ${
                        selected
                          ? 'border-[#020817] bg-[#020817] text-white'
                          : 'border-[#e7e5e0] bg-white text-[#64748b] hover:border-[#c3cdfd] hover:text-[#020817]'
                      }`}
                    >
                      {v.label}
                    </button>
                  )
                })}
              </div>
              <button
                type="button"
                onClick={addSticker}
                disabled={spots.length >= 60}
                className="ml-auto text-[13px] font-semibold text-[#4166fb] transition hover:text-[#3558e8] disabled:opacity-50 max-sm:ml-auto"
              >
                + Add sticker
              </button>
            </div>
            <div className="grid items-start gap-8 lg:grid-cols-[400px_minmax(0,1fr)] xl:gap-12">
              {/* Sticker list — BrandMyMac-style Spot / Size / Bid rows. */}
              <div className="order-2 lg:order-1">
                <ul className="space-y-1">
                  {preview.spots.map((p, i) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => focusSticker(p.id, i)}
                        className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition hover:bg-[#f1f0ec]/70 ${
                          editingSpot === p.id ? 'bg-[#e9edfe]/60' : ''
                        }`}
                      >
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[#020817] font-mono text-[11px] font-semibold text-white">
                          {i + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.label}</span>
                        <span className="hidden shrink-0 font-mono text-[10px] tracking-[0.06em] text-[#64748b] sm:inline">
                          {spots[i]?.view === INSIDE_VIEW_ID ? 'INSIDE' : 'LID'}
                        </span>
                        <span className={`shrink-0 whitespace-nowrap font-mono text-[13px] ${p.price > 0 ? 'text-[#020817]' : 'text-[#64748b]'}`}>
                          {p.price > 0 ? `from ${formatMoney(p.price, preview.currency)}` : 'No price yet'}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between border-t border-[#e7e5e0] px-4 py-3">
                  <span className="text-[14px] font-semibold">Total asking</span>
                  <span className="whitespace-nowrap font-mono text-[13px] text-[#020817]">
                    {total > 0 ? formatMoney(total, currency) : '—'}
                    {priced.length < spots.length && total > 0 ? ` + ${spots.length - priced.length} unpriced` : ''}
                  </span>
                </div>
                <p className="mt-4 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-[#64748b]">
                  Publishing auto-lays out.
                </p>
              </div>
              {/* Live Mac — sticky on desktop like the auction visual. */}
              <div id="mac-preview" className="order-1 scroll-mt-20 lg:order-2 lg:sticky lg:top-20 lg:self-start">
                <SpecSheet
                  listing={preview}
                  onClaim={() => {}}
                  onBid={() => {}}
                  activeViewId={activeView}
                  onActiveViewChange={setActiveView}
                  hideTabs
                  onPlaceSpot={placeSpot}
                  onMoveSpot={moveSpot}
                  onResizeSpot={resizeSpot}
                  onRemoveSpot={removeSpot}
                  onSelectSpot={setEditingSpot}
                  selectedSpotId={editingSpot}
                  spotPanel={editingIdx >= 0 ? (
                /* Spot editor: name + starting bid. Keyed by spot so it autofocuses on each open. */
                <div
                  key={editingSpot}
                  className="rounded-2xl bg-white p-4 shadow-[0_16px_40px_rgba(2,8,23,0.18)]"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold">Spot {editingIdx + 1}</span>
                    <button
                      type="button"
                      aria-label="Close sticker panel"
                      onClick={() => setEditingSpot(null)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#020817]"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <label className="mb-[6px] block text-[13px] font-semibold" htmlFor="spot-label">Name</label>
                  <input
                    id="spot-label"
                    placeholder={`Spot ${editingIdx + 1}`}
                    className={`${field} mb-3`}
                    value={spots[editingIdx]?.label ?? ''}
                    onChange={(e) => updateSpot(editingIdx, { label: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                  />
                  <label className="mb-[6px] block text-[13px] font-semibold" htmlFor="spot-price">Starts at</label>
                  <input
                    id="spot-price"
                    type="number"
                    min={1}
                    autoFocus
                    placeholder="0"
                    className={field}
                    value={spots[editingIdx]?.price ?? ''}
                    onChange={(e) => updateSpot(editingIdx, { price: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
                  />
                  <p className="mt-2 text-[12px] leading-snug text-[#64748b]">Buyers bid up from here. First bid ≥ this.</p>
                  {spots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSpot(preview.spots[editingIdx].id)}
                      className="mt-3 text-[12px] font-medium text-[#dc2626] transition hover:text-[#991b1b]"
                    >
                      Remove spot
                    </button>
                  )}
                </div>
              ) : undefined}
            />
              </div>
            </div>
          </section>

          {error && <p className="text-center text-sm font-medium text-[#dc2626]">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="font-mono text-[11px] tracking-[0.04em] text-[#64748b]">
              MOCK PUBLISHING · SELLER = X SESSION · LAYOUT AUTO ON PUBLISH
            </p>
            <button type="button" onClick={review} className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-7 py-[15px] text-[16px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#3558e8]">
              {PRIVY_ENABLED && (!x?.authenticated || !x.handle) ? 'Log in with X to publish' : 'Publish Mac space'}
            </button>
          </div>
        </form>
      </main>

      {/* Review gate — the only path to `goLive`. Only the Publish CTA opens this;
          the listing goes live only when "Go live" is clicked here. */}
      {reviewing && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/50 p-6"
          onClick={() => { if (!publishing) setReviewing(false) }}
        >
          <div
            className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-white p-8 shadow-[0_24px_64px_rgba(2,8,23,0.28)]"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="review-title" className="mb-1 text-[22px]">Review before it goes live</h2>
            <p className="mb-6 text-[14px] text-[#64748b]">Nothing is public yet. Check every detail — this is the last step.</p>
            <dl className="mb-4 space-y-3 text-[14px]">
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[#64748b]">Surface</dt>
                <dd className="truncate font-medium">MacBook lid · auction</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[#64748b]">Seller</dt>
                <dd className="truncate font-medium">{PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[#64748b]">Title</dt>
                <dd className="truncate font-medium">{title.trim()}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[#64748b]">Goal</dt>
                <dd className="truncate font-medium">{goal.trim() || 'Fund my goal'}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-[#64748b]">Deadline</dt>
                <dd className="font-medium">{prettyDeadline(deadline)}</dd>
              </div>
            </dl>
            <ul className="mb-2 space-y-3">
              {preview.spots.map((p) => (
                <li key={p.id} className="flex items-center gap-3 text-[14px]">
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.label}</span>
                  <span className="whitespace-nowrap font-mono text-[13px] text-[#64748b]">from {formatMoney(p.price, preview.currency)}</span>
                </li>
              ))}
            </ul>
            <div className="mb-6 flex items-center justify-between border-t border-[#e7e5e0] pt-3 text-[14px]">
              <span className="font-semibold">Total asking</span>
              <span className="whitespace-nowrap font-mono text-[13px]">{formatMoney(total, preview.currency)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setReviewing(false)}
                disabled={publishing}
                className="text-[14px] font-medium text-[#020817] transition hover:text-[#64748b] disabled:opacity-60"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={goLive}
                disabled={publishing}
                className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-6 py-[10px] text-[14px] font-medium text-white shadow-sm transition hover:bg-[#3558e8] disabled:opacity-60"
              >
                {publishing ? 'Publishing…' : 'Go live'}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  )
}
