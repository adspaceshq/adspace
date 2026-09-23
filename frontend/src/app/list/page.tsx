'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import SpecSheet from '@/components/SpecSheet'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { INSIDE_VIEW_ID, formatMoney, gearInsideView, gearPhotoView, type LidPlacement, type Listing } from '@/lib/listings'
import { PRIVY_ENABLED } from '@/lib/privy'

const field =
  'w-full rounded-lg border border-[#e7e5e0] bg-white px-[14px] py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition focus:border-[#4166fb] focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none'

interface SpotDraft {
  label: string
  size: string
  price: string
  /* View the sticker lives on — the deck when set to 'inside'. Absent = the lid, where every spot starts. */
  view?: string
  /* Sticker position in % of that view's photo, set by clicking or dragging in the preview. Absent = auto-laid out. */
  x?: number
  y?: number
  /* Sticker width in % of that view's photo, set by dragging the corner handle in the preview. Absent = auto width. */
  w?: number
}

const toDateInput = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const prettyDeadline = (input: string) => {
  const d = new Date(`${input}T12:00:00`)
  return Number.isNaN(d.getTime()) ? input : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function ListPage() {
  const { addListing } = useStore()
  const router = useRouter()

  const [sellerName, setSellerName] = useState('')
  const [title, setTitle] = useState('')
  const surface = 'gear'
  const [goal, setGoal] = useState('')
  const [deadline, setDeadline] = useState(() => toDateInput(new Date(Date.now() + 14 * 86_400_000)))
  const priceType = 'auction' as const
  const [spots, setSpots] = useState<SpotDraft[]>([{ label: '', size: '', price: '' }])
  // Preview id of the spot whose price panel is open — set by dropping or tapping a sticker.
  const [editingSpot, setEditingSpot] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [x, setX] = useState<XIdentity | null>(null)

  const updateSpot = (i: number, patch: Partial<SpotDraft>) =>
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // Live preview of what buyers will see — rebuilt from the form on every keystroke.
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

  // Seller editor: a click on bare photo drops a spot there — on the view that was clicked — and opens
  // the side panel so the price is the next thing typed. Preview ids are positional: the new spot is last.
  const placeSpot = (x: number, y: number, viewId: string) => {
    setSpots((prev) => [...prev, { label: '', size: '', price: '', view: viewId, x, y }])
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

  const publish = async (e: React.FormEvent) => {
    e.preventDefault()
    // Seller: verified X handle when Privy is configured, manual name in demo mode.
    if (PRIVY_ENABLED) {
      if (!x?.ready || x.loggingIn) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    const seller = PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()
    if (!seller || !title.trim() || spots.length === 0) {
      setError('Your name, a title and at least one spot are required.')
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
    let newId: string
    try {
      newId = await addListing(listing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish. Try again.')
      return
    }
    router.push(`/listings/${newId}`)
  }

  return (
    <>
      <Header />
      {PRIVY_ENABLED && <XProbe onChange={setX} />}
      <main className="mx-auto w-full max-w-[1080px] px-6 pb-16 pt-8">
        <div className="mb-8">
          <h1 className="mb-2" style={{ fontSize: '40px' }}>List your space.</h1>
          <p className="text-[16px] text-[#64748b]">Describe the surface, add the spots, set the prices. Live in under a minute — mock publishing, no charge.</p>
        </div>

        <form onSubmit={publish} className="flex flex-col gap-8">
          <section className="rounded-2xl border border-[#e7e5e0] bg-white p-8">
            <h2 className="mb-6 text-[22px]">The basics</h2>
            <div className="mb-5 flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-name">Your name</label>
              {PRIVY_ENABLED ? (
                x?.authenticated && x.handle ? (
                  <input id="list-name" className={field} value={x.handle} readOnly aria-readonly />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => x?.login()}
                      disabled={!x?.ready || x?.loggingIn}
                      className="rounded-lg bg-[#020817] px-4 py-3 text-[15px] font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
                    >
                      {x?.loggingIn ? 'Redirecting to X…' : 'Log in with X to list'}
                    </button>
                    {x?.error && <p className="text-sm font-medium text-[#dc2626]">{x.error}</p>}
                  </>
                )
              ) : (
                <input id="list-name" className={field} placeholder="vana" value={sellerName} onChange={(e) => setSellerName(e.target.value)} required />
              )}
            </div>
            <div className="mb-5 flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-title">Title</label>
              <input id="list-title" className={field} placeholder="Put your brand on my …" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-goal">Goal</label>
                <input id="list-goal" className={field} placeholder="Fund my trip" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-deadline">Deadline</label>
                <input id="list-deadline" type="date" className={field} value={deadline} min={toDateInput(new Date())} onChange={(e) => setDeadline(e.target.value)} required />
              </div>
            </div>
          </section>

          <section className="rounded-2xl border border-[#e7e5e0] bg-white p-8">
            <h2 className="mb-1 text-[22px]">Spots &amp; preview</h2>
            <p className="mb-6 text-sm text-[#64748b]">
              What buyers will see. Click either photo to drop a spot — a panel opens next to it for its
              starting price. Tap a sticker to reopen it, drag to move it, its corner dot to size it, and
              hover for a dot to remove it.
            </p>
            <SpecSheet
              listing={preview}
              onClaim={() => {}}
              onBid={() => {}}
              onPlaceSpot={placeSpot}
              onMoveSpot={moveSpot}
              onResizeSpot={resizeSpot}
              onRemoveSpot={removeSpot}
              onSelectSpot={setEditingSpot}
              selectedSpotId={editingSpot}
              spotPanel={editingIdx >= 0 ? (
                /* The only field a spot needs. Keyed by spot so it autofocuses on each open. */
                <div
                  key={editingSpot}
                  className="rounded-xl border border-[#e7e5e0] bg-white p-4 shadow-[0_16px_40px_rgba(2,8,23,0.16)]"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <span className="truncate text-[14px] font-semibold">{preview.spots[editingIdx].label}</span>
                    <button
                      type="button"
                      aria-label="Close price panel"
                      onClick={() => setEditingSpot(null)}
                      className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#020817]"
                    >
                      <X size={14} />
                    </button>
                  </div>
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
                  />
                  <p className="mt-2 text-[12px] leading-snug text-[#64748b]">Buyers bid up from here.</p>
                  {spots.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSpot(preview.spots[editingIdx].id)}
                      className="mt-3 inline-flex items-center gap-1 rounded-full border border-[#e7e5e0] px-3 py-[6px] text-[12px] font-medium text-[#dc2626] transition hover:border-[#fecaca] hover:bg-[#fef2f2]"
                    >
                      <X size={12} /> Remove spot
                    </button>
                  )}
                </div>
              ) : undefined}
            />
            {/* The spots so far and the price decided for each. Tap a row to reopen its price panel
                (the panel pops next to the sticker when it's on the photo view in front of you). */}
            <ul className="mt-5 divide-y divide-[#e7e5e0] rounded-xl border border-[#e7e5e0]">
              {preview.spots.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => setEditingSpot(p.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-[#fafaf7] ${
                      editingSpot === p.id ? 'bg-[#f4f7ff]' : ''
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.label}</span>
                    <span className="whitespace-nowrap rounded-full border border-[#e7e5e0] bg-white px-[8px] py-[2px] font-mono text-[10px] tracking-[0.06em] text-[#64748b]">
                      {spots[i]?.view === INSIDE_VIEW_ID ? 'INSIDE' : 'LID'}
                    </span>
                    <span className={`whitespace-nowrap font-mono text-[13px] ${p.price > 0 ? 'text-[#020817]' : 'text-[#64748b]'}`}>
                      {p.price > 0 ? `from ${formatMoney(p.price, preview.currency)}` : 'No price yet'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-4 font-mono text-[11px] leading-relaxed tracking-[0.04em] text-[#64748b]">
              Placement, sticker size, and which photo a spot sits on are preview-only for now — publishing
              lays the stickers out automatically.
            </p>
          </section>

          {error && <p className="text-sm font-medium text-[#dc2626]">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-7 py-[15px] text-[16px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#3558e8]">
              {PRIVY_ENABLED && (!x?.authenticated || !x.handle) ? 'Log in with X to publish' : 'Publish space'}
            </button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  )
}
