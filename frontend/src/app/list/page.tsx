'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'
import {
  ArrowRight,
  Check,
  ChevronRight,
  DollarSign,
  Gavel,
  Info,
  Laptop,
  Plus,
  Shirt,
  Sparkles,
  Tag,
  Target,
  Trash2,
  UploadCloud,
  X,
  Zap,
} from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PageShell from '@/components/PageShell'
import SpecSheet from '@/components/SpecSheet'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import {
  INSIDE_VIEW_ID,
  LID_VIEW_ID,
  TEE_BACK_VIEW_ID,
  TEE_FRONT_VIEW_ID,
  TEE_LEFT_VIEW_ID,
  TEE_RIGHT_VIEW_ID,
  formatMoney,
  freeSlotOnView,
  gearInsideView,
  gearPhotoView,
  pinDraftPositions,
  teeBackView,
  teeFrontView,
  teeLeftView,
  teeRightView,
  type LidPlacement,
  type Listing,
} from '@/lib/listings'
import { PRIVY_ENABLED } from '@/lib/privy'

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
  const { addListing } = useStore()
  const router = useRouter()

  const [sellerName, setSellerName] = useState('')
  const [title, setTitle] = useState('')
  // Second surface alongside the Mac: 'gear' is the MacBook lid,
  // 'apparel' is the T-shirt (model-photo editor and buyer view).
  const [surface, setSurface] = useState<'gear' | 'apparel'>('gear')
  const isTee = surface === 'apparel'
  const [goal, setGoal] = useState('')
  const [deadline, setDeadline] = useState(() => toDateInput(new Date(Date.now() + 14 * 86_400_000)))
  // Optional artwork due date: buyers must submit final art by then (empty = none).
  const [artworkClose, setArtworkClose] = useState('')
  const [priceType, setPriceType] = useState<'fixed' | 'auction' | null>(null)
  const [minIncrement, setMinIncrement] = useState('1')
  const [spots, setSpots] = useState<SpotDraft[]>([{ label: '', size: '', price: '' }])
  // Id of the spot whose price panel is open — set by dropping or tapping a sticker.
  const [editingSpot, setEditingSpot] = useState<string | null>(null)
  // Which Mac view is on screen. Row clicks drive it so the Mac jumps to the tapped sticker's view.
  const [activeView, setActiveView] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Review gate: submitting the form (button or Enter) only opens the confirm dialog —
  // nothing is submitted until "Submit for review" is clicked there.
  const [reviewing, setReviewing] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [x, setX] = useState<XIdentity | null>(null)
  // Optional surface photo: replaces the preset Mac/T-shirt shots for buyers.
  const [image, setImage] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  // Shrink uploads to a listing-grade photo (max 1200px) so the data URL stays
  // well under the API's ~3 MB cap. Same inline pattern as buyer logos.
  const photoDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        for (const size of [1200, 800, 400]) {
          const scale = Math.min(1, size / Math.max(img.width, img.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          const ctx = canvas.getContext('2d')
          if (!ctx) break
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const jpg = canvas.toDataURL('image/jpeg', 0.85)
          if (jpg.length <= 2_500_000 || size === 400) {
            resolve(jpg)
            return
          }
        }
        reject(new Error('could not shrink photo'))
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('could not read photo'))
      }
      img.src = url
    })

  const onPhotoFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setImageError('Photo must be an image file.')
      return
    }
    if (file.size > 8 * 1024 * 1024) {
      setImageError('Photo must be under 8 MB.')
      return
    }
    setImageBusy(true)
    setImageError(null)
    photoDataUrl(file).then(
      (dataUrl) => {
        setImage(dataUrl)
        setImageBusy(false)
      },
      () => {
        setImageError('Could not read that file.')
        setImageBusy(false)
      },
    )
  }

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
    // Tee branch first: each spot lives on the model shot it was dropped on
    // (front, back, either side) — unlabeled drafts start on the front.
    if (isTee) {
      const teeIds: Record<string, string[]> = {
        [TEE_FRONT_VIEW_ID]: [],
        [TEE_BACK_VIEW_ID]: [],
        [TEE_LEFT_VIEW_ID]: [],
        [TEE_RIGHT_VIEW_ID]: [],
      }
      const teePlaced: Record<string, LidPlacement> = {}
      pspots.forEach((p, i) => {
        const draft = spots[i]
        const view = draft.view ?? TEE_FRONT_VIEW_ID
        ;(teeIds[view] ??= []).push(p.id)
        if (draft.x != null || draft.y != null || draft.w != null) {
          teePlaced[p.id] = { x: draft.x, y: draft.y, w: draft.w }
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
        priceType: priceType ?? 'fixed',
        spots: pspots,
        mockup: {
          views: [
            teeFrontView(teeIds[TEE_FRONT_VIEW_ID], teePlaced),
            teeBackView(teeIds[TEE_BACK_VIEW_ID], teePlaced),
            teeLeftView(teeIds[TEE_LEFT_VIEW_ID], teePlaced),
            teeRightView(teeIds[TEE_RIGHT_VIEW_ID], teePlaced),
          ],
        },
      }
    }
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
      priceType: priceType ?? 'fixed',
      spots: pspots,
      mockup: { views: [gearPhotoView(lidIds, lidPlaced), gearInsideView(deckIds, deckPlaced)] },
    }
  }, [spots, title, surface, isTee, priceType])

  // A click on bare photo drops a spot exactly where clicked — on the view that was
  // clicked — and opens the side panel so the price is the next thing typed.
  const placeSpot = (x: number, y: number, viewId: string) => {
    setSpots((prev) => [
      ...pinDraftPositions(prev, isTee ? TEE_FRONT_VIEW_ID : LID_VIEW_ID),
      { label: '', size: '', price: '', view: viewId, x, y },
    ])
    setActiveView(viewId)
    setEditingSpot(`preview-s${spots.length + 1}`)
  }

  // Preview ids carry no index, so match the sticker back to its draft by position in the list.
  const moveSpot = (spotId: string, x: number, y: number) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0) return
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, x, y } : s)))
  }

  // Resize from the sticker's corner handle.
  const resizeSpot = (spotId: string, w: number | null) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0) return
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, w: w ?? undefined } : s)))
  }

  // Remove from the sticker's dot (or Delete on a focused sticker). Keeps one spot.
  const removeSpot = (spotId: string) => {
    const i = preview.spots.findIndex((p) => p.id === spotId)
    if (i < 0 || spots.length <= 1) return
    setEditingSpot(null)
    setSpots((prev) => pinDraftPositions(prev, isTee ? TEE_FRONT_VIEW_ID : LID_VIEW_ID).filter((_, j) => j !== i))
  }

  // Index of the spot the price panel is open for; -1 keeps the panel hidden.
  const editingIdx = editingSpot ? preview.spots.findIndex((p) => p.id === editingSpot) : -1

  // Summary strip metrics: count · floor price · close date.
  const priced = spots.map((s) => Number(s.price)).filter((p) => p > 0)
  const floor = priced.length ? Math.min(...priced) : 0
  const total = priced.reduce((a, b) => a + b, 0)
  const currency = preview.currency ?? 'USD'

  const addSticker = () => {
    if (spots.length >= 60) {
      setError('Max 60 spots per listing.')
      return
    }
    const mainView = isTee ? TEE_FRONT_VIEW_ID : LID_VIEW_ID
    const pinned = pinDraftPositions(spots, isTee ? TEE_FRONT_VIEW_ID : LID_VIEW_ID)
    const taken = pinned.filter((s) => (s.view ?? mainView) === mainView).map((s) => ({ x: s.x ?? 50, y: s.y ?? 50 }))
    const slot = freeSlotOnView(taken, mainView)
    setSpots([...pinned, { label: '', size: '', price: '', view: mainView, x: slot.x, y: slot.y }])
    setActiveView(mainView)
    setEditingSpot(`preview-s${pinned.length + 1}`)
  }

  const focusSticker = (rowId: string, i: number) => {
    const v = spots[i]?.view
    setEditingSpot(rowId)
    setActiveView(isTee ? (v ?? TEE_FRONT_VIEW_ID) : v === INSIDE_VIEW_ID ? v : LID_VIEW_ID)
    document.getElementById('studio-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const review = () => {
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
    if (!priceType) {
      setError('Choose fixed price or auction.')
      return
    }
    if (!deadline) {
      setError('Pick a listing deadline.')
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

  const submitListing = async () => {
    if (publishing) return
    if (!priceType) {
      setError('Choose fixed price or auction.')
      setReviewing(false)
      return
    }
    if (priceType === 'auction' && !(Number(minIncrement) > 0)) {
      setError('Enter an auction bid increment above zero.')
      return
    }
    setPublishing(true)
    const seller = PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()
    const id = `user-${Date.now()}`
    const spotIds = spots.map((_, i) => `${id}-s${i + 1}`)
    const spotView = (i: number) =>
      isTee ? (spots[i].view ?? 'tee-front') : spots[i].view === INSIDE_VIEW_ID ? 'inside' : 'lid'
    const onDeck = (i: number) => spotView(i) === 'inside'
    const listing: Listing = {
      id,
      title: title.trim(),
      goal: goal.trim() || 'Fund my goal',
      description: '',
      image,
      artworkClose: artworkClose ? new Date(`${artworkClose}T23:59:00`).toISOString() : undefined,
      surface,
      fabric: isTee ? '#1b1b20' : undefined,
      seller: { name: seller, handle: PRIVY_ENABLED ? seller : '', color: '#4166fb' },
      deadline: prettyDeadline(deadline),
      endsAt: new Date(`${deadline}T23:59:00`).toISOString(),
      priceType,
      minIncrement: priceType === 'auction' ? Number(minIncrement) : undefined,
      spots: spots.map((s, i) => ({
        id: `${id}-s${i + 1}`,
        label: s.label.trim() || `Spot ${i + 1}`,
        size: s.size.trim() || 'M',
        price: Number(s.price),
        view: spotView(i),
        x: s.x,
        y: s.y,
        w: s.w,
      })),
      mockup: {
        views: isTee
          ? [
              teeFrontView(spotIds.filter((_, i) => spotView(i) === 'tee-front')),
              teeBackView(spotIds.filter((_, i) => spotView(i) === 'tee-back')),
              teeLeftView(spotIds.filter((_, i) => spotView(i) === 'tee-left')),
              teeRightView(spotIds.filter((_, i) => spotView(i) === 'tee-right')),
            ]
          : [
              gearPhotoView(spotIds.filter((_, i) => !onDeck(i))),
              gearInsideView(spotIds.filter((_, i) => onDeck(i))),
            ],
      },
    }
    try {
      await addListing(listing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit. Try again.')
      setReviewing(false)
      setPublishing(false)
      return
    }
    router.push('/dashboard')
  }

  return (
    <>
      <PageShell>
        <Header />
        {PRIVY_ENABLED && <XProbe onChange={setX} />}

        <main className="bg-[#f4f4f4] pb-24 pt-6 sm:pt-10">
          {/* Hero Header — Awwwards Site-of-the-Day treatment matching landing page */}
          <section className="relative mx-auto w-full max-w-[1340px] px-4 sm:px-6">
            <div className="flex flex-col items-center pb-8 pt-4 text-center sm:pb-12 sm:pt-6">

              <motion.h1
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.05 }}
                className="font-extrabold lowercase text-[#020817]"
                style={{ fontSize: 'clamp(38px, 6.5vw, 88px)', letterSpacing: '-0.04em', lineHeight: 0.95 }}
              >
                {isTee ? 'list your t-shirt.' : 'list your mac lid.'}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="mx-auto mt-4 max-w-[56ch] text-[16px] text-[#020817]/70 sm:text-[18px]"
              >
                Drop your sticker spots directly on the surface, set starting prices, and let brands claim or bid.
              </motion.p>

              {/* Dynamic Status / Summary Pills */}
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="mt-6 flex flex-wrap items-center justify-center gap-2"
              >
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e0] bg-white px-3.5 py-1.5 font-mono text-[12px] font-medium text-[#020817] shadow-xs">
                  <span className="text-[#64748b]">SPOTS:</span> {spots.length}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e0] bg-white px-3.5 py-1.5 font-mono text-[12px] font-medium text-[#020817] shadow-xs">
                  <span className="text-[#64748b]">{priceType === 'auction' ? 'MIN BID:' : 'FLOOR:'}</span>{' '}
                  {floor > 0 ? formatMoney(floor, currency) : 'UNSET'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e0] bg-white px-3.5 py-1.5 font-mono text-[12px] font-medium text-[#020817] shadow-xs">
                  <span className="text-[#64748b]">EST. ASKING:</span>{' '}
                  <span className="font-semibold text-[#020817]">{total > 0 ? formatMoney(total, currency) : '—'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e5e0] bg-white px-3.5 py-1.5 font-mono text-[12px] font-medium text-[#020817] shadow-xs">
                  <span className="text-[#64748b]">CLOSES:</span> {prettyDeadline(deadline)}
                </span>
              </motion.div>
            </div>
          </section>

          {/* Main Studio Workstation Layout: Controls on Left, Sticky Live Interactive SpecSheet on Right */}
          <section className="mx-auto w-full max-w-[1340px] px-4 sm:px-6">
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_500px] xl:grid-cols-[minmax(0,1fr)_560px]">
                
                {/* LEFT COLUMN: Configuration Steps */}
                <div className="flex flex-col gap-6">

                  {/* Step 1: Surface & Model */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="overflow-hidden rounded-3xl border border-[#e7e5e0] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.03)] sm:p-8"
                  >
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f0ec] pb-5">
                      <div>
                        <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                          Step 01
                        </span>
                        <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                          Surface & Pricing
                        </h2>
                      </div>
                      <span className="rounded-full bg-[#f1f5f9] px-3 py-1 font-mono text-[11px] font-medium text-[#475569]">
                        Format
                      </span>
                    </div>

                    {/* Surface Selector */}
                    <div className="mb-6 flex flex-col gap-2.5">
                      <label className="text-[13px] font-semibold text-[#020817]" id="surface-label">
                        Choose your surface
                      </label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="surface-label">
                        {([
                          {
                            key: 'gear',
                            title: 'MacBook lid',
                            sub: 'Sticker placements on outer lid & inside deck',
                            icon: Laptop,
                          },
                          {
                            key: 'apparel',
                            title: 'T-shirt',
                            sub: 'Print zones across front, back, & sleeves',
                            icon: Shirt,
                          },
                        ] as const).map((opt) => {
                          const selected = surface === opt.key
                          const Icon = opt.icon
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => {
                                if (surface === opt.key) return
                                setSurface(opt.key)
                                setSpots((prev) => prev.map((s) => ({ label: s.label, size: s.size, price: s.price })))
                                setEditingSpot(null)
                                setActiveView(null)
                              }}
                              className={`group relative flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-all duration-150 sm:p-5 ${
                                selected
                                  ? 'border-[#4166fb] bg-[#f5f8ff] shadow-[0_0_0_2px_#4166fb,0_8px_20px_-4px_rgba(65,102,251,0.15)]'
                                  : 'border-[#e7e5e0] bg-white hover:border-[#cbd5e1] hover:bg-[#fafaf9]'
                              }`}
                            >
                              <div
                                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
                                  selected ? 'bg-[#4166fb] text-white' : 'bg-[#f1f5f9] text-[#020817] group-hover:bg-[#e2e8f0]'
                                }`}
                              >
                                <Icon size={20} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="block text-[15px] font-bold text-[#020817]">{opt.title}</span>
                                  {selected && <Check size={16} className="text-[#4166fb]" />}
                                </div>
                                <span className="mt-1 block text-[13px] leading-snug text-[#64748b]">{opt.sub}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Pricing Model Selector */}
                    <div className="flex flex-col gap-2.5">
                      <label className="text-[13px] font-semibold text-[#020817]" id="pricing-label">
                        Pricing model
                      </label>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-labelledby="pricing-label">
                        {([
                          {
                            key: 'fixed',
                            title: 'Fixed price',
                            sub: 'Instant claim. First sponsor pays your set price.',
                            icon: Tag,
                          },
                          {
                            key: 'auction',
                            title: 'Auction',
                            sub: 'Competitive bidding. Sponsors outbid each other.',
                            icon: Gavel,
                          },
                        ] as const).map((opt) => {
                          const selected = priceType === opt.key
                          const Icon = opt.icon
                          return (
                            <button
                              key={opt.key}
                              type="button"
                              role="radio"
                              aria-checked={selected}
                              onClick={() => setPriceType(opt.key)}
                              className={`group relative flex items-start gap-3.5 rounded-2xl border p-4 text-left transition-all duration-150 sm:p-5 ${
                                selected
                                  ? 'border-[#4166fb] bg-[#f5f8ff] shadow-[0_0_0_2px_#4166fb,0_8px_20px_-4px_rgba(65,102,251,0.15)]'
                                  : 'border-[#e7e5e0] bg-white hover:border-[#cbd5e1] hover:bg-[#fafaf9]'
                              }`}
                            >
                              <div
                                className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl transition ${
                                  selected ? 'bg-[#4166fb] text-white' : 'bg-[#f1f5f9] text-[#020817] group-hover:bg-[#e2e8f0]'
                                }`}
                              >
                                <Icon size={20} />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between">
                                  <span className="block text-[15px] font-bold text-[#020817]">{opt.title}</span>
                                  {selected && <Check size={16} className="text-[#4166fb]" />}
                                </div>
                                <span className="mt-1 block text-[13px] leading-snug text-[#64748b]">{opt.sub}</span>
                              </div>
                            </button>
                          )
                        })}
                      </div>

                      {priceType === 'auction' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="mt-3 rounded-2xl border border-[#c3cdfd] bg-[#f5f8ff] p-4.5"
                        >
                          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#020817]" htmlFor="min-increment">
                            Minimum bid increment ($ / USDC)
                            <div className="relative mt-1">
                              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-sm text-[#64748b]">
                                $
                              </span>
                              <input
                                id="min-increment"
                                type="number"
                                inputMode="decimal"
                                min="0.01"
                                step="0.01"
                                value={minIncrement}
                                onChange={(e) => setMinIncrement(e.target.value)}
                                className="w-full rounded-xl border border-[#c3cdfd] bg-white py-2.5 pl-8 pr-4 font-mono text-[15px] font-medium text-[#020817] focus:border-[#4166fb] focus:outline-none focus:ring-3 focus:ring-[#4166fb]/15"
                                required
                              />
                            </div>
                            <span className="text-[12px] font-normal text-[#64748b]">
                              Each new bid must exceed the previous leader by at least this amount.
                            </span>
                          </label>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>

                  {/* Step 2: Campaign Details */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 }}
                    className="overflow-hidden rounded-3xl border border-[#e7e5e0] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.03)] sm:p-8"
                  >
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-[#f1f0ec] pb-5">
                      <div>
                        <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                          Step 02
                        </span>
                        <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                          Listing Details
                        </h2>
                      </div>
                      <span className="rounded-full bg-[#f1f5f9] px-3 py-1 font-mono text-[11px] font-medium text-[#475569]">
                        Meta
                      </span>
                    </div>

                    <div className="flex flex-col gap-5">
                      {/* Seller Verification via X */}
                      {PRIVY_ENABLED ? (
                        !(x?.authenticated && x.handle) ? (
                          <div className="rounded-2xl border border-dashed border-[#cbd5e1] bg-[#fafaf9] p-5 text-center">
                            <p className="text-[14px] font-medium text-[#020817]">Log in with X to list your space</p>
                            <p className="mt-1 text-[13px] text-[#64748b]">
                              Identity and payouts are verified through your authenticated X profile.
                            </p>
                            <button
                              type="button"
                              onClick={() => x?.login()}
                              disabled={!x?.ready || x?.loggingIn}
                              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#020817] px-6 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
                            >
                              {x?.loggingIn ? 'Redirecting to X…' : 'Authenticate with X'}
                            </button>
                            {x?.error && <p className="mt-2 text-sm font-medium text-[#dc2626]">{x.error}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between rounded-2xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3.5">
                            <div className="flex items-center gap-3">
                              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#020817] text-white font-mono text-xs font-bold">
                                𝕏
                              </span>
                              <div>
                                <span className="block text-[13px] font-semibold text-[#020817]">@{x.handle}</span>
                                <span className="block text-[11px] text-[#16a34a] font-medium">Verified X Session</span>
                              </div>
                            </div>
                            <span className="font-mono text-xs text-[#64748b]">Devnet Ready</span>
                          </div>
                        )
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-semibold text-[#020817]" htmlFor="seller-name">
                            Your seller name / handle
                          </label>
                          <input
                            id="seller-name"
                            placeholder="e.g. vana or @spotboard"
                            value={sellerName}
                            onChange={(e) => setSellerName(e.target.value)}
                            className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none"
                            required
                          />
                        </div>
                      )}

                      {/* Listing Title */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[13px] font-semibold text-[#020817]" htmlFor="listing-title">
                          Space title
                        </label>
                        <input
                          id="listing-title"
                          placeholder={isTee ? 'Put your brand on my T-shirt at TOKEN2049' : 'Put your brand on my MacBook lid'}
                          value={title}
                          onChange={(e) => setTitle(e.target.value)}
                          className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none"
                          required
                        />
                      </div>

                      {/* Goal & Deadline Grid */}
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-semibold text-[#020817]" htmlFor="listing-goal">
                            Fundraising goal
                          </label>
                          <input
                            id="listing-goal"
                            placeholder={isTee ? 'Fund my community merch' : 'Fund my travel to DevCon'}
                            value={goal}
                            onChange={(e) => setGoal(e.target.value)}
                            className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <label className="text-[13px] font-semibold text-[#020817]" htmlFor="listing-deadline">
                            Campaign deadline
                          </label>
                          <input
                            id="listing-deadline"
                            type="date"
                            value={deadline}
                            min={toDateInput(new Date())}
                            onChange={(e) => setDeadline(e.target.value)}
                            className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none"
                            required
                          />
                        </div>
                      </div>

                      {/* Optional Artwork Due Date */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[13px] font-semibold text-[#020817]" htmlFor="artwork-due">
                          Artwork submission deadline <span className="font-normal text-[#64748b]">(optional)</span>
                        </label>
                        <input
                          id="artwork-due"
                          type="date"
                          value={artworkClose}
                          min={toDateInput(new Date())}
                          onChange={(e) => setArtworkClose(e.target.value)}
                          className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none"
                        />
                        <span className="text-[12px] text-[#64748b]">
                          Final SVG or high-res transparent artwork must be uploaded by sponsors by this date.
                        </span>
                      </div>

                      {/* Custom Surface Photo (Optional) */}
                      <div className="flex flex-col gap-2">
                        <span className="text-[13px] font-semibold text-[#020817]" id="custom-photo-label">
                          Custom surface photo <span className="font-normal text-[#64748b]">(optional)</span>
                        </span>
                        {image ? (
                          <div className="flex items-center gap-4 rounded-2xl border border-[#e7e5e0] bg-[#fafaf9] p-3">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={image}
                              alt="Surface preview"
                              className="h-20 w-28 rounded-xl border border-[#e7e5e0] object-cover"
                            />
                            <div className="flex-1">
                              <span className="block text-[14px] font-semibold text-[#020817]">Custom photo attached</span>
                              <span className="block text-[12px] text-[#64748b]">Will replace default 3D renders</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setImage('')
                                setImageError(null)
                              }}
                              className="mr-2 inline-flex items-center gap-1 text-[13px] font-medium text-[#dc2626] transition hover:text-[#991b1b]"
                            >
                              <Trash2 size={14} /> Remove
                            </button>
                          </div>
                        ) : (
                          <label
                            htmlFor="custom-photo-input"
                            aria-labelledby="custom-photo-label"
                            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#cbd5e1] bg-[#fafaf9] p-6 text-center transition hover:border-[#4166fb] hover:bg-white"
                          >
                            <div className="grid h-10 w-10 place-items-center rounded-xl bg-white shadow-xs text-[#4166fb]">
                              <UploadCloud size={20} />
                            </div>
                            <div>
                              <p className="text-[14px] font-semibold text-[#020817]">
                                {imageBusy ? 'Processing photo…' : 'Upload your authentic surface photo'}
                              </p>
                              <p className="mt-0.5 text-[12px] text-[#64748b]">
                                JPG, PNG up to 8MB. Buyers will inspect this exact surface.
                              </p>
                            </div>
                          </label>
                        )}
                        <input
                          id="custom-photo-input"
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            onPhotoFile(e.target.files?.[0])
                            e.target.value = ''
                          }}
                        />
                        {imageError && <p className="text-sm font-medium text-[#dc2626]">{imageError}</p>}
                      </div>
                    </div>
                  </motion.div>

                  {/* Step 3: Spot Roster & Pricing Breakdown */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="overflow-hidden rounded-3xl border border-[#e7e5e0] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.03)] sm:p-8"
                  >
                    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f0ec] pb-5">
                      <div>
                        <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                          Step 03
                        </span>
                        <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                          Spots Roster
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={addSticker}
                        disabled={spots.length >= 60}
                        className="inline-flex items-center gap-1.5 rounded-full border border-[#020817] bg-[#020817] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-black disabled:opacity-50"
                      >
                        <Plus size={14} /> {isTee ? 'Add Print Zone' : 'Add Sticker'}
                      </button>
                    </div>

                    <p className="mb-5 text-[14px] text-[#64748b]">
                      Click any row below to jump to that spot on the canvas, or click directly on the preview to drop new spots.
                    </p>

                    {/* Spot list rows */}
                    <div className="space-y-2">
                      {preview.spots.map((p, i) => {
                        const isSelected = editingSpot === p.id
                        const viewName = spots[i]?.view === INSIDE_VIEW_ID
                          ? 'INSIDE DECK'
                          : spots[i]?.view === TEE_BACK_VIEW_ID
                          ? 'BACK PRINT'
                          : spots[i]?.view === TEE_LEFT_VIEW_ID
                          ? 'LEFT SLEEVE'
                          : spots[i]?.view === TEE_RIGHT_VIEW_ID
                          ? 'RIGHT SLEEVE'
                          : isTee
                          ? 'FRONT PRINT'
                          : 'OUTER LID'

                        return (
                          <div
                            key={p.id}
                            className={`group flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition ${
                              isSelected
                                ? 'border-[#4166fb] bg-[#f5f8ff] shadow-[0_0_0_2px_#4166fb]'
                                : 'border-[#e7e5e0] bg-[#fafaf9] hover:border-[#cbd5e1] hover:bg-white'
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() => focusSticker(p.id, i)}
                              className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none"
                            >
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#020817] font-mono text-[12px] font-bold text-white">
                                {i + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="truncate text-[14px] font-semibold text-[#020817]">
                                    {p.label}
                                  </span>
                                  <span className="rounded bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-[#64748b] border border-[#e7e5e0]">
                                    {viewName}
                                  </span>
                                </div>
                                <span className="block text-[12px] text-[#64748b]">
                                  {p.price > 0 ? (
                                    <span className="font-mono font-medium text-[#020817]">
                                      {priceType === 'auction' ? 'Starts at ' : 'Asking '}
                                      {formatMoney(p.price, preview.currency)}
                                    </span>
                                  ) : (
                                    <span className="text-[#dc2626] font-medium">Unpriced — click to price</span>
                                  )}
                                </span>
                              </div>
                            </button>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => focusSticker(p.id, i)}
                                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-[#4166fb] border border-[#c3cdfd] hover:bg-[#e9edfe] transition"
                              >
                                {isSelected ? 'Editing' : 'Edit'}
                              </button>
                              {spots.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSpot(p.id)}
                                  aria-label={`Remove spot ${i + 1}`}
                                  className="grid h-8 w-8 place-items-center rounded-lg text-[#94a3b8] transition hover:bg-[#fee2e2] hover:text-[#dc2626]"
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>

                    {/* Total Asking Summary */}
                    <div className="mt-5 flex items-center justify-between border-t border-[#f1f0ec] pt-4">
                      <div>
                        <span className="block text-[14px] font-bold text-[#020817]">Total asking value</span>
                        <span className="block text-[12px] text-[#64748b]">
                          {priced.length} of {spots.length} spots priced
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-xl font-bold text-[#020817]">
                          {total > 0 ? formatMoney(total, currency) : '—'}
                        </span>
                        {priced.length < spots.length && (
                          <span className="block text-[11px] font-medium text-[#dc2626]">
                            +{spots.length - priced.length} spot(s) unpriced
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* Submit Action Card */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="flex flex-col gap-4 rounded-3xl border border-[#e7e5e0] bg-white p-6 shadow-[0_4px_24px_rgba(0,0,0,0.03)] sm:p-8"
                  >
                    {error && (
                      <div className="flex items-center gap-2.5 rounded-2xl border border-[#fecaca] bg-[#fef2f2] p-4 text-[14px] font-medium text-[#b91c1c]">
                        <X size={18} className="shrink-0 text-[#dc2626]" />
                        <span>{error}</span>
                      </div>
                    )}

                    <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
                      <div className="flex items-center gap-3">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#16a34a]/10 text-[#16a34a]">
                          <Zap size={18} />
                        </span>
                        <div>
                          <p className="text-[14px] font-semibold text-[#020817]">Ready for review</p>
                          <p className="text-[12px] text-[#64748b]">
                            Settle in devnet USDC · Instant verification via X
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={review}
                        className="group inline-flex w-full items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#4166fb] px-8 py-4 text-[16px] font-semibold text-white shadow-[0_10px_40px_-8px_rgba(65,102,251,0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#3558e8] active:translate-y-0 active:scale-[0.98] sm:w-auto"
                      >
                        {PRIVY_ENABLED && (!x?.authenticated || !x.handle) ? (
                          'Log in with X to list'
                        ) : (
                          <>
                            <span>{isTee ? 'Review T-shirt space' : 'Review Mac space'}</span>
                            <ArrowRight
                              size={18}
                              aria-hidden="true"
                              className="transition-transform duration-150 group-hover:translate-x-1"
                            />
                          </>
                        )}
                      </button>
                    </div>
                  </motion.div>
                </div>

                {/* RIGHT COLUMN: Sticky Live Studio Canvas (SpecSheet) */}
                <div id="studio-canvas" className="scroll-mt-6 lg:sticky lg:top-8 flex flex-col gap-4">
                  <div className="overflow-hidden rounded-3xl border border-[#e7e5e0] bg-white p-5 shadow-[0_12px_36px_rgba(0,0,0,0.06)] sm:p-6">
                    {/* Canvas Header / View Switcher */}
                    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#f1f0ec] pb-4">
                      {/* View tabs */}
                      {preview.mockup.views.length > 1 ? (
                        <div className="flex gap-1.5" role="tablist" aria-label="Surface views">
                          {preview.mockup.views.map((v) => {
                            const fallback = isTee ? TEE_FRONT_VIEW_ID : LID_VIEW_ID
                            const selected = (activeView ?? fallback) === v.id
                            return (
                              <button
                                key={v.id}
                                type="button"
                                role="tab"
                                aria-selected={selected}
                                onClick={() => setActiveView(v.id)}
                                className={`rounded-full px-3.5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition ${
                                  selected
                                    ? 'bg-[#020817] text-white shadow-xs'
                                    : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#020817]'
                                }`}
                              >
                                {v.label}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[#020817]">
                          Live Surface
                        </span>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#16a34a]">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a] animate-pulse" />
                          Live Studio
                        </span>
                      </div>
                    </div>

                    {/* Interactive SpecSheet Canvas */}
                    <div className="relative">
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
                        onDismissSpotPanel={() => setEditingSpot(null)}
                        selectedSpotId={editingSpot}
                        spotPanel={
                          editingIdx >= 0 ? (
                            /* Premium spot pricing popup directly attached to selected sticker */
                            <div
                              key={editingSpot}
                              className="w-64 rounded-2xl border border-[#e7e5e0] bg-white p-4 shadow-[0_20px_48px_rgba(2,8,23,0.22)]"
                            >
                              <div className="mb-3 flex items-center justify-between gap-2 border-b border-[#f1f0ec] pb-2">
                                <span className="font-mono text-[12px] font-bold text-[#020817]">
                                  SPOT {editingIdx + 1} CONFIG
                                </span>
                                <button
                                  type="button"
                                  aria-label="Close sticker panel"
                                  onClick={() => setEditingSpot(null)}
                                  className="grid h-6 w-6 place-items-center rounded-full text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#020817]"
                                >
                                  <X size={14} />
                                </button>
                              </div>

                              <label className="mb-1 block text-[12px] font-semibold text-[#020817]" htmlFor="spot-label">
                                Spot label
                              </label>
                              <input
                                id="spot-label"
                                placeholder={`Spot ${editingIdx + 1}`}
                                className="mb-3 w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] px-3 py-2 text-[14px] text-[#020817] focus:border-[#4166fb] focus:bg-white focus:outline-none"
                                value={spots[editingIdx]?.label ?? ''}
                                onChange={(e) => updateSpot(editingIdx, { label: e.target.value })}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') e.preventDefault()
                                }}
                              />

                              <label className="mb-1 block text-[12px] font-semibold text-[#020817]" htmlFor="spot-price">
                                {priceType === 'auction' ? 'Starting bid ($)' : 'Fixed price ($)'}
                              </label>
                              <div className="relative mb-2">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-[#64748b]">
                                  $
                                </span>
                                <input
                                  id="spot-price"
                                  type="number"
                                  min={1}
                                  autoFocus
                                  placeholder="25"
                                  className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafaf9] py-2 pl-7 pr-3 font-mono text-[14px] font-semibold text-[#020817] focus:border-[#4166fb] focus:bg-white focus:outline-none"
                                  value={spots[editingIdx]?.price ?? ''}
                                  onChange={(e) => updateSpot(editingIdx, { price: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.preventDefault()
                                  }}
                                />
                              </div>

                              <p className="text-[11px] leading-snug text-[#64748b]">
                                {priceType === 'auction'
                                  ? 'First bid must meet or exceed this amount.'
                                  : 'First buyer pays this amount to claim.'}
                              </p>

                              {spots.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeSpot(preview.spots[editingIdx].id)}
                                  className="mt-3 flex w-full items-center justify-center gap-1 rounded-lg border border-[#fee2e2] bg-[#fef2f2] py-1.5 text-[12px] font-medium text-[#dc2626] transition hover:bg-[#fecaca]"
                                >
                                  <Trash2 size={13} /> Remove this spot
                                </button>
                              )}
                            </div>
                          ) : undefined
                        }
                      />
                    </div>

                    {/* Canvas Help Tips */}
                    <div className="mt-4 rounded-xl border border-[#f1f0ec] bg-[#fafaf9] p-3 text-center">
                      <p className="text-[12px] font-medium text-[#64748b]">
                        ✨ <span className="text-[#020817] font-semibold">Click surface</span> to drop spots ·{' '}
                        <span className="text-[#020817] font-semibold">Drag</span> to reposition ·{' '}
                        <span className="text-[#020817] font-semibold">Corner dot</span> to resize
                      </p>
                    </div>
                  </div>

                  {/* Surface Telemetry Card */}
                  <div className="rounded-3xl border border-[#e7e5e0] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.02)]">
                    <div className="grid grid-cols-2 gap-4 divide-x divide-[#f1f0ec]">
                      <div className="pl-1">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[#64748b]">
                          Total Asking
                        </span>
                        <p className="mt-1 font-mono text-2xl font-extrabold text-[#020817]">
                          {total > 0 ? formatMoney(total, currency) : '—'}
                        </p>
                        <span className="text-[11px] text-[#16a34a] font-medium">
                          {priced.length} spots priced
                        </span>
                      </div>
                      <div className="pl-4">
                        <span className="font-mono text-[11px] uppercase tracking-wider text-[#64748b]">
                          Floor Bid
                        </span>
                        <p className="mt-1 font-mono text-2xl font-extrabold text-[#020817]">
                          {floor > 0 ? formatMoney(floor, currency) : '—'}
                        </p>
                        <span className="text-[11px] text-[#64748b]">
                          Ends {prettyDeadline(deadline)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </form>
          </section>
        </main>
      </PageShell>

      <Footer />

      {/* Review Dialog Modal */}
      <AnimatePresence>
        {reviewing && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/60 p-4 backdrop-blur-sm sm:p-6"
            onClick={() => {
              if (!publishing) setReviewing(false)
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2 }}
              className="max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-3xl bg-white p-6 shadow-[0_24px_64px_rgba(2,8,23,0.28)] sm:p-8"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <span className="rounded-full bg-[#f1f5f9] px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider text-[#020817]">
                  Final Review
                </span>
                <button
                  type="button"
                  onClick={() => setReviewing(false)}
                  disabled={publishing}
                  className="grid h-8 w-8 place-items-center rounded-full text-[#64748b] hover:bg-[#f1f5f9] hover:text-[#020817]"
                >
                  <X size={16} />
                </button>
              </div>

              <h2 id="review-title" className="text-2xl font-bold tracking-tight text-[#020817]">
                Ready to publish your space?
              </h2>
              <p className="mt-1 text-[14px] text-[#64748b]">
                This submits your space for platform verification. Payouts settle in devnet USDC.
              </p>

              <div className="mt-6 rounded-2xl border border-[#e7e5e0] bg-[#fafaf9] p-4 text-[14px]">
                <dl className="space-y-3">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Surface</dt>
                    <dd className="truncate font-semibold text-[#020817]">{isTee ? 'T-shirt' : 'MacBook lid'}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Pricing model</dt>
                    <dd className="truncate font-semibold text-[#020817]">
                      {priceType === 'fixed' ? 'Fixed price' : 'Auction'}
                    </dd>
                  </div>
                  {priceType === 'auction' && (
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="shrink-0 text-[#64748b]">Min bid increment</dt>
                      <dd className="truncate font-mono font-semibold text-[#020817]">
                        {formatMoney(Number(minIncrement), preview.currency)}
                      </dd>
                    </div>
                  )}
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Seller</dt>
                    <dd className="truncate font-semibold text-[#020817]">
                      {PRIVY_ENABLED ? `@${x?.handle}` : sellerName.trim()}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Title</dt>
                    <dd className="truncate font-semibold text-[#020817]">{title.trim()}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Goal</dt>
                    <dd className="truncate font-medium text-[#020817]">{goal.trim() || 'Fund my goal'}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#64748b]">Deadline</dt>
                    <dd className="font-semibold text-[#020817]">{prettyDeadline(deadline)}</dd>
                  </div>
                  {artworkClose && (
                    <div className="flex items-baseline justify-between gap-4">
                      <dt className="shrink-0 text-[#64748b]">Artwork due</dt>
                      <dd className="font-semibold text-[#020817]">{prettyDeadline(artworkClose)}</dd>
                    </div>
                  )}
                </dl>
              </div>

              {/* Spots list */}
              <div className="mt-5 max-h-48 overflow-y-auto rounded-2xl border border-[#e7e5e0] p-3">
                <ul className="space-y-2">
                  {preview.spots.map((p, i) => (
                    <li key={p.id} className="flex items-center justify-between text-[13px]">
                      <span className="truncate font-medium text-[#020817]">
                        {i + 1}. {p.label}
                      </span>
                      <span className="font-mono font-semibold text-[#020817]">
                        {priceType === 'auction' ? 'start ' : ''}
                        {formatMoney(p.price, preview.currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-[#e7e5e0] pt-4">
                <span className="font-bold text-[#020817]">
                  {priceType === 'auction' ? 'Total starting bids' : 'Total asking value'}
                </span>
                <span className="font-mono text-xl font-extrabold text-[#020817]">
                  {formatMoney(total, preview.currency)}
                </span>
              </div>

              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setReviewing(false)}
                  disabled={publishing}
                  className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-[#64748b] transition hover:bg-[#f1f5f9] hover:text-[#020817] disabled:opacity-60"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={submitListing}
                  disabled={publishing}
                  className="inline-flex items-center gap-2 rounded-full bg-[#4166fb] px-7 py-3 text-[15px] font-semibold text-white shadow-[0_10px_30px_-6px_rgba(65,102,251,0.6)] transition hover:bg-[#3558e8] disabled:opacity-60"
                >
                  {publishing ? 'Submitting…' : 'Submit for review'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
