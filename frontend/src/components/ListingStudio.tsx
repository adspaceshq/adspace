'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { motion, AnimatePresence } from 'motion/react'
import {
  AlertCircle,
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
import { useSurfacePicker } from '@/components/SurfacePickerModal'
import { useToast } from '@/components/ToastProvider'
import { dataUrlToBlob, uploadToCloudinary } from '@/lib/cloudinary'
import { userErrorMessage } from '@/lib/errors'
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
  /* View the sticker lives on - the deck when set to 'inside'. Absent = the lid, where every spot starts. */
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

interface ListingStudioProps {
  surface?: 'gear' | 'apparel'
}

export default function ListingStudio({ surface: initialSurface = 'gear' }: ListingStudioProps) {
  return (
    <Suspense>
      <ListingStudioInner initialSurface={initialSurface} />
    </Suspense>
  )
}

function ListingStudioInner({ initialSurface }: { initialSurface: 'gear' | 'apparel' }) {
  const { addListing } = useStore()
  const toast = useToast()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { openPicker } = useSurfacePicker()

  const [sellerName, setSellerName] = useState('')
  const [title, setTitle] = useState('')
  // Surface families: 'gear' covers laptop lids and similar hardware,
  // 'apparel' is the T-shirt (model-photo editor and buyer view).
  const [surface, setSurface] = useState<'gear' | 'apparel'>(() => {
    const s = searchParams.get('surface')
    if (s === 'apparel' || s === 'gear') return s
    return initialSurface
  })

  // Synchronize surface with URL or prop if changed
  useEffect(() => {
    const s = searchParams.get('surface')
    if (s === 'apparel' || s === 'gear') {
      setSurface(s)
      setEditingSpot(null)
      setActiveView(null)
    } else {
      setSurface(initialSurface)
      setEditingSpot(null)
      setActiveView(null)
    }
  }, [searchParams, initialSurface])

  const isTee = surface === 'apparel'
  const surfaceLabel = isTee ? 'T-shirt' : 'Gear surface'
  const [goal, setGoal] = useState('')
  const [deadline, setDeadline] = useState(() => toDateInput(new Date(Date.now() + 14 * 86_400_000)))
  // Optional artwork due date: buyers must submit final art by then (empty = none).
  const [artworkClose, setArtworkClose] = useState('')
  const [priceType, setPriceType] = useState<'fixed' | 'auction' | null>(null)
  const [minIncrement, setMinIncrement] = useState('1')
  const [spots, setSpots] = useState<SpotDraft[]>([{ label: '', size: '', price: '' }])
  // Id of the spot whose price panel is open - set by dropping or tapping a sticker.
  const [editingSpot, setEditingSpot] = useState<string | null>(null)
  // Which Mac view is on screen. Row clicks drive it so the Mac jumps to the tapped sticker's view.
  const [activeView, setActiveView] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Review gate: submitting the form (button or Enter) only opens the confirm dialog -
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
    photoDataUrl(file)
      .then(async (dataUrl) => {
        const blob = await dataUrlToBlob(dataUrl)
        const url = await uploadToCloudinary(blob, 'listings', file.name.replace(/\.[^.]+$/, '.jpg'))
        setImage(url)
        setImageBusy(false)
      })
      .catch((err) => {
        setImageError(userErrorMessage(err, 'Could not upload that photo. Try a different image.'))
        setImageBusy(false)
      })
  }

  const updateSpot = (i: number, patch: Partial<SpotDraft>) =>
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  // Live view of what buyers will see - rebuilt from the form on every keystroke.
  const preview: Listing = useMemo(() => {
    const pid = 'preview'
    const pspots = spots.map((s, i) => ({
      id: `${pid}-s${i + 1}`,
      label: s.label.trim() || `Spot ${i + 1}`,
      size: s.size.trim() || 'M',
      price: Number(s.price) || 0,
    }))
    // Tee branch first: each spot lives on the model shot it was dropped on
    // (front, back, either side) - unlabeled drafts start on the front.
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

  // A click on bare photo drops a spot exactly where clicked - on the view that was
  // clicked - and opens the side panel so the price is the next thing typed.
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
    if (!seller) {
      setError('Please authenticate with X to list.')
      return
    }
    const hasTitle = Boolean(title.trim())
    const hasSpots = spots.length > 0

    if (!hasTitle && !hasSpots) {
      setError('A title and at least one spot are required.')
      document.getElementById('listing-title')?.focus()
      document.getElementById('listing-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!hasTitle) {
      setError('Please enter a space title to continue.')
      document.getElementById('listing-title')?.focus()
      document.getElementById('listing-title')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!hasSpots) {
      setError('Please place at least one sponsor spot on the canvas above.')
      document.getElementById('studio-canvas')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    if (!priceType) {
      setError('Please choose a pricing format (Fixed price or Auction).')
      return
    }
    if (!deadline) {
      setError('Please pick a campaign deadline.')
      document.getElementById('listing-deadline')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
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
    const toastId = toast.loading('Submitting listing', 'Sending your space to the review queue.')
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
      const message = userErrorMessage(err, 'Could not submit. Try again.')
      setError(message)
      toast.update(toastId, {
        title: 'Could not submit listing',
        description: message,
        tone: 'error',
      })
      setReviewing(false)
      setPublishing(false)
      return
    }
    toast.update(toastId, {
      title: 'Listing submitted',
      description: 'A reviewer will check the terms before it goes live.',
      tone: 'success',
    })
    router.push('/dashboard')
  }

  const studioCanvas = (
    <div id="studio-canvas" className="scroll-mt-6 flex flex-col gap-4">
      {/* Canvas Header / View Switcher */}
      {preview.mockup.views.length > 1 && (
        <div className="relative mb-4 flex items-center justify-center">
          {/* Centered Animated View tabs */}
          <div
            className="inline-flex items-center rounded-full bg-[#eae9e4] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"
            role="tablist"
            aria-label="Surface views"
          >
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
                  className="relative rounded-full px-4 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#020817]"
                >
                  {selected && (
                    <motion.span
                      layoutId="activeViewTab"
                      className="absolute inset-0 rounded-full bg-[#020817] shadow-sm"
                      transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                    />
                  )}
                  <span
                    className={`relative z-10 transition-colors duration-200 ${
                      selected ? 'text-white' : 'text-[#64748b] hover:text-[#020817]'
                    }`}
                  >
                    {v.label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Interactive SpecSheet Canvas */}
      <div className="relative">
          <SpecSheet
            listing={preview}
            onClaim={() => {}}
            onBid={() => {}}
            activeViewId={activeView}
            onActiveViewChange={setActiveView}
            hideTabs
            hideFooter
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
                <motion.div
                  key={editingSpot}
                  initial={{ opacity: 0, scale: 0.9, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, y: 4 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="w-[min(17rem,calc(100vw-2rem))] rounded-2xl border border-[#e7e5e0] bg-white p-4 shadow-[0_20px_48px_rgba(2,8,23,0.22)]"
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
                    {priceType === 'auction' ? 'Starting bid ($)' : priceType === 'fixed' ? 'Fixed price ($)' : 'Spot price ($)'}
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

                  {/* Quick price presets */}
                  <div className="mb-3 flex items-center gap-1.5">
                    {[15, 25, 50, 100].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => updateSpot(editingIdx, { price: String(preset) })}
                        className={`rounded-lg px-2.5 py-1 font-mono text-[11px] font-semibold transition ${
                          Number(spots[editingIdx]?.price) === preset
                            ? 'bg-[#020817] text-white shadow-xs'
                            : 'bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0] hover:text-[#020817]'
                        }`}
                      >
                        ${preset}
                      </button>
                    ))}
                  </div>

                  <p className="text-[11px] leading-snug text-[#64748b]">
                    {priceType === 'auction'
                      ? 'First bid must meet or exceed this amount.'
                      : priceType === 'fixed'
                      ? 'First buyer pays this amount to claim.'
                      : 'Choose Fixed price or Auction below before submitting.'}
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
                </motion.div>
              ) : undefined
            }
          />
        </div>
    </div>
  )

  return (
    <>
      <PageShell>
        <Header />
        {PRIVY_ENABLED && <XProbe onChange={setX} />}

        <main className="bg-[#f4f4f4] pb-24 pt-6 sm:pt-10">
          {/* Hero Header */}
          <section className="relative mx-auto w-full max-w-[1340px] px-4 sm:px-6">
            <div className="flex flex-col items-center pb-6 pt-3 text-center sm:pb-8 sm:pt-4">
              <span className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-[#64748b]">
                Surface Studio
              </span>
              <motion.h1
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="text-2xl sm:text-[32px] font-medium tracking-tight text-[#020817]"
              >
                {isTee ? 'List your T-shirt' : 'List your gear surface'}
              </motion.h1>

              <motion.p
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 }}
                className="mx-auto mt-2 max-w-[50ch] text-[14px] text-[#64748b]"
              >
                Drop your sponsor spots directly on the surface, set pricing, and let brands claim or bid.
              </motion.p>
            </div>
          </section>

          {/* Main Studio Workstation: Centered Mac Canvas, then Centered Workflow Steps */}
          <section className="mx-auto w-full max-w-[960px] px-4 sm:px-6">
            <form onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-8">
              {studioCanvas}
              <div className="flex flex-col gap-6">

                  {/* Step 1: sale type */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="flex flex-col items-center pt-2 text-center"
                  >
                    <div>
                      <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                        Step 01
                      </span>
                      <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                        Choose sale type
                      </h2>
                    </div>

                    {/* Centered Animated Segmented Pill Control */}
                    <div className="mt-4 flex justify-center">
                      <div
                        className="inline-flex items-center rounded-full bg-[#eae9e4] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)]"
                        role="radiogroup"
                        aria-label="Pricing format"
                      >
                        {([
                          { key: 'fixed', label: 'Fixed price', icon: Tag },
                          { key: 'auction', label: 'Auction', icon: Gavel },
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
                              className="relative flex items-center gap-2 rounded-full px-5 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider transition-colors duration-200 focus-visible:outline-none"
                            >
                              {selected && (
                                <motion.span
                                  layoutId="pricingFormatTab"
                                  className="absolute inset-0 rounded-full bg-[#020817] shadow-sm"
                                  transition={{ type: 'spring', stiffness: 450, damping: 35 }}
                                />
                              )}
                              <Icon size={14} className={`relative z-10 transition-colors ${selected ? 'text-white' : 'text-[#64748b]'}`} />
                              <span
                                className={`relative z-10 transition-colors duration-200 ${
                                  selected ? 'text-white' : 'text-[#64748b] hover:text-[#020817]'
                                }`}
                              >
                                {opt.label}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* Explanatory subtitle with motion */}
                    <div className="mx-auto mt-3 max-w-md">
                      <AnimatePresence mode="wait">
                        <motion.p
                          key={priceType}
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          transition={{ duration: 0.15 }}
                          className="text-[14px] text-[#64748b]"
                        >
                          {priceType === 'fixed'
                            ? 'Instant claim - first sponsor to pay your asking price secures the spot immediately.'
                            : priceType === 'auction'
                            ? 'Competitive bidding - brands place bids on your spots and outbid each other until your listing closes.'
                            : 'Choose how sponsors will buy your spots. This controls the pricing fields and review terms.'}
                        </motion.p>
                      </AnimatePresence>

                      <div className="mt-4 grid gap-2 text-left sm:grid-cols-2">
                        {([
                          {
                            key: 'fixed',
                            title: 'Fixed price',
                            copy: 'Sponsors claim spots immediately at your set price.',
                          },
                          {
                            key: 'auction',
                            title: 'Auction',
                            copy: 'Sponsors bid until the deadline; reviewer sets auction fees.',
                          },
                        ] as const).map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => setPriceType(item.key)}
                            className={`rounded-2xl border p-3 text-left transition ${
                              priceType === item.key
                                ? 'border-[#4166fb] bg-[#f3f6ff] shadow-[0_10px_30px_rgba(65,102,251,0.12)]'
                                : 'border-[#e7e5e0] bg-white hover:border-[#cfd6fb]'
                            }`}
                          >
                            <span className="block text-[13px] font-semibold text-[#020817]">{item.title}</span>
                            <span className="mt-1 block text-[12px] leading-relaxed text-[#64748b]">{item.copy}</span>
                          </button>
                        ))}
                      </div>

                      {priceType === 'auction' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="mx-auto mt-4 flex flex-col gap-1.5 text-left sm:max-w-xs"
                        >
                          <label className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#64748b]" htmlFor="min-increment">
                            Minimum bid increment ($)
                          </label>
                          <div className="relative">
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
                              className="w-full rounded-xl border border-[#e5e4de] bg-white py-2.5 pl-8 pr-4 font-mono text-[14px] font-medium text-[#020817] shadow-xs focus:border-[#020817] focus:outline-none"
                              required
                            />
                          </div>
                          <span className="text-[12px] text-[#64748b]">
                            Each new bid must exceed the previous leader by at least this amount.
                          </span>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>

                  {/* Step 2: Campaign Details */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.05 }}
                    className="pt-8"
                  >
                    <div className="mb-6 flex flex-col items-center text-center">
                      <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                        Step 02
                      </span>
                      <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                        Listing Details
                      </h2>
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
                              onClick={() => {
                                if (x?.privyAuthenticated && !x?.hasX) {
                                  x?.linkX()
                                } else {
                                  x?.login({ method: 'twitter' })
                                }
                              }}
                              disabled={x?.loggingIn}
                              className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#020817] px-6 py-2.5 text-[14px] font-medium text-white transition hover:bg-[#0f1a33] active:scale-[0.98] disabled:opacity-60 cursor-pointer shadow-xs"
                            >
                              {x?.loggingIn ? (
                                <>
                                  <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                  <span>Connecting to X...</span>
                                </>
                              ) : (
                                <>
                                  <span className="font-mono text-xs font-bold">X</span>
                                  <span>Authenticate with X</span>
                                </>
                              )}
                            </button>
                            {x?.error && <p className="mt-2 text-sm font-medium text-[#dc2626]">{x.error}</p>}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between rounded-2xl border border-[#e5e4de] bg-white px-4 py-3 shadow-xs">
                            <div className="flex items-center gap-3">
                              <div className="relative">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={x.avatar ? x.avatar.replace('_normal.', '_400x400.') : `https://unavatar.io/x/${encodeURIComponent(x.handle.replace('@', ''))}`}
                                  alt={x.handle}
                                  width={44}
                                  height={44}
                                  referrerPolicy="no-referrer"
                                  className="h-10 w-10 shrink-0 rounded-full object-cover ring-2 ring-[#f1f0ec]"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLElement).style.display = 'none'
                                    const fallback = e.currentTarget.parentElement?.querySelector('.avatar-fallback') as HTMLElement | null
                                    if (fallback) fallback.style.display = 'grid'
                                  }}
                                />
                                <span
                                  style={{ display: 'none' }}
                                  className="avatar-fallback grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#020817] font-mono text-xs font-bold text-white ring-2 ring-[#f1f0ec]"
                                >
                                  {x.handle.replace('@', '').charAt(0).toUpperCase()}
                                </span>
                                <span className="absolute -bottom-0.5 -right-0.5 grid h-4 w-4 place-items-center rounded-full bg-[#020817] font-mono text-[9px] font-bold text-white ring-2 ring-white">
                                  X
                                </span>
                              </div>
                              <div>
                                <span className="block text-[14px] font-semibold text-[#020817]">
                                  {x.handle.startsWith('@') ? x.handle : `@${x.handle}`}
                                </span>
                              </div>
                            </div>
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

                      {/* Error Alert above Title */}
                      <AnimatePresence>
                        {error && (
                          <motion.div
                            initial={{ opacity: 0, y: -6, height: 0 }}
                            animate={{ opacity: 1, y: 0, height: 'auto' }}
                            exit={{ opacity: 0, y: -6, height: 0 }}
                            transition={{ duration: 0.2, ease: 'easeOut' }}
                            className="overflow-hidden"
                          >
                            <div className="flex items-center gap-2.5 rounded-xl border border-rose-200/90 bg-rose-50/80 px-3.5 py-2.5 text-[13px] font-medium text-rose-700 shadow-xs">
                              <AlertCircle size={16} className="shrink-0 text-rose-500" />
                              <span className="flex-1">{error}</span>
                              <button
                                type="button"
                                onClick={() => setError(null)}
                                className="rounded p-0.5 text-rose-400 hover:text-rose-700 transition"
                                aria-label="Dismiss error"
                              >
                                <X size={14} />
                              </button>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Listing Title */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[13px] font-semibold text-[#020817]" htmlFor="listing-title">
                          Space title
                        </label>
                        <input
                          id="listing-title"
                          placeholder={isTee ? 'Put your brand on my T-shirt at TOKEN2049' : 'Put your brand on my laptop lid'}
                          value={title}
                          onChange={(e) => {
                            setTitle(e.target.value)
                            if (error && (error.toLowerCase().includes('title') || error.includes('spot'))) {
                              setError(null)
                            }
                          }}
                          className={`w-full rounded-xl border ${
                            error && !title.trim()
                              ? 'border-rose-400 bg-rose-50/20 focus:border-rose-500 focus:shadow-[0_0_0_3px_#ffe4e6]'
                              : 'border-[#e7e5e0] bg-[#fafaf9] hover:bg-white focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe]'
                          } px-4 py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition focus:outline-none`}
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

                    </div>
                  </motion.div>

                  {/* Step 3: Spot Roster & Pricing Breakdown */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 }}
                    className="pt-8"
                  >
                    <div className="mb-6 flex flex-col items-center text-center">
                      <span className="block font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">
                        Step 03
                      </span>
                      <h2 className="text-xl font-bold tracking-tight text-[#020817] sm:text-2xl">
                        Spots Roster
                      </h2>
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={addSticker}
                          disabled={spots.length >= 60}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#020817] bg-[#020817] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-black disabled:opacity-50"
                        >
                          <Plus size={14} /> {isTee ? 'Add Print Zone' : 'Add Sticker'}
                        </button>
                      </div>
                    </div>

                    <p className="mb-5 text-center text-[14px] text-[#64748b]">
                      Click any row below to jump to that spot on the canvas, or click directly on the preview to drop new spots.
                    </p>

                    {/* Spot list rows */}
                    <div className="space-y-2">
                      <AnimatePresence initial={false}>
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
                            <motion.div
                              key={p.id}
                              layout
                              initial={{ opacity: 0, y: 12, scale: 0.98 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              exit={{ opacity: 0, scale: 0.95 }}
                              transition={{ duration: 0.2 }}
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
                                    <AnimatePresence mode="wait">
                                      {p.price > 0 ? (
                                        <motion.span
                                          key={`price-${p.price}`}
                                          initial={{ opacity: 0, x: -3 }}
                                          animate={{ opacity: 1, x: 0 }}
                                          exit={{ opacity: 0, x: 3 }}
                                          transition={{ duration: 0.15 }}
                                          className="inline-block font-mono font-medium text-[#020817]"
                                        >
                                          {priceType === 'auction' ? 'Starts at ' : 'Asking '}
                                          {formatMoney(p.price, preview.currency)}
                                        </motion.span>
                                      ) : (
                                        <motion.span
                                          key="unpriced"
                                          initial={{ opacity: 0 }}
                                          animate={{ opacity: 1 }}
                                          exit={{ opacity: 0 }}
                                          className="inline-block text-[#dc2626] font-medium"
                                        >
                                          Unpriced - click to price
                                        </motion.span>
                                      )}
                                    </AnimatePresence>
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
                            </motion.div>
                          )
                        })}
                      </AnimatePresence>
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
                        <AnimatePresence mode="wait">
                          <motion.span
                            key={`total-${total}`}
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: 4 }}
                            transition={{ duration: 0.15 }}
                            className="block font-mono text-xl font-bold text-[#020817]"
                          >
                            {total > 0 ? formatMoney(total, currency) : '-'}
                          </motion.span>
                        </AnimatePresence>
                        {priced.length < spots.length && (
                          <span className="block text-[11px] font-medium text-[#dc2626]">
                            +{spots.length - priced.length} spot(s) unpriced
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>

                  {/* Submit Action */}
                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.15 }}
                    className="pt-8 pb-6 flex flex-col gap-4"
                  >
                    <div className="flex flex-col items-center pt-2">
                      <button
                        type="button"
                        onClick={review}
                        className="group inline-flex items-center justify-center gap-2.5 whitespace-nowrap rounded-full bg-[#4166fb] px-9 py-4 text-[16px] font-semibold text-white shadow-[0_10px_40px_-8px_rgba(65,102,251,0.7)] transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#3558e8] active:translate-y-0 active:scale-[0.98]"
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
              initial={{ opacity: 0, scale: 0.95, y: 14 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 14 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="max-h-[92vh] w-full max-w-[500px] overflow-y-auto rounded-[28px] bg-white p-6 sm:p-8 shadow-[0_24px_70px_-12px_rgba(2,8,23,0.35)]"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="review-title" className="text-2xl font-bold tracking-tight text-[#020817]">
                    Ready to publish?
                  </h2>
                  <p className="mt-1 text-[13px] text-[#64748b]">
                    Review your space details before submitting for platform verification.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReviewing(false)}
                  disabled={publishing}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#64748b] transition hover:bg-[#f1f0ec] hover:text-[#020817]"
                  aria-label="Close review"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Creator & Campaign Details (Seamless, no borders, no box) */}
              <div className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    {x?.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={x.avatar.replace('_normal.', '_400x400.')}
                        alt=""
                        width={28}
                        height={28}
                        referrerPolicy="no-referrer"
                        className="h-7 w-7 rounded-full object-cover ring-1 ring-black/10 shrink-0"
                      />
                    ) : (
                      <span className="grid h-7 w-7 place-items-center rounded-full bg-[#020817] font-mono text-[11px] font-bold text-white shrink-0">
                        X
                      </span>
                    )}
                    <span className="truncate text-[14px] font-semibold text-[#020817]">
                      {x?.handle
                        ? (x.handle.startsWith('@') ? x.handle : `@${x.handle}`)
                        : (sellerName.trim().startsWith('@') ? sellerName.trim() : `@${sellerName.trim()}`)}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#64748b] shrink-0">
                    {surfaceLabel} · {priceType === 'fixed' ? 'Fixed price' : 'Auction'}
                  </span>
                </div>

                <div>
                  <h3 className="text-[17px] font-bold text-[#020817] leading-snug">
                    {title.trim()}
                  </h3>
                  {goal.trim() && (
                    <p className="mt-1 text-[13px] text-[#64748b]">
                      Goal: <span className="font-medium text-[#020817]">{goal.trim()}</span>
                    </p>
                  )}
                </div>

                {/* Dates & Increments */}
                <div className="grid grid-cols-2 gap-3 text-[12px]">
                  <div>
                    <span className="text-[#64748b] block text-[11px]">Campaign Deadline</span>
                    <span className="font-semibold text-[#020817] block mt-0.5">
                      {prettyDeadline(deadline)}
                    </span>
                  </div>
                  {artworkClose ? (
                    <div>
                      <span className="text-[#64748b] block text-[11px]">Artwork Due</span>
                      <span className="font-semibold text-[#020817] block mt-0.5">
                        {prettyDeadline(artworkClose)}
                      </span>
                    </div>
                  ) : priceType === 'auction' ? (
                    <div>
                      <span className="text-[#64748b] block text-[11px]">Min Bid Increment</span>
                      <span className="font-mono font-semibold text-[#020817] block mt-0.5">
                        {formatMoney(Number(minIncrement), preview.currency)}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Spots List (Clean, borderless) */}
              <div className="mt-6">
                <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-[#64748b] mb-2">
                  <span>Configured Spots ({preview.spots.length})</span>
                  <span>Price</span>
                </div>
                <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                  {preview.spots.map((p, i) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between py-1.5 text-[13px]"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[#f1f0ec] font-mono text-[11px] font-bold text-[#64748b]">
                          {i + 1}
                        </span>
                        <span className="truncate font-medium text-[#020817]">
                          {p.label}
                        </span>
                      </div>
                      <span className="font-mono font-semibold text-[#020817] shrink-0 ml-3">
                        {priceType === 'auction' ? 'start ' : ''}
                        {formatMoney(p.price, preview.currency)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Total Asking Row (Borderless) */}
              <div className="mt-6 flex items-center justify-between">
                <div>
                  <span className="block text-[14px] font-bold text-[#020817]">
                    {priceType === 'auction' ? 'Total starting bids' : 'Total asking value'}
                  </span>
                  <span className="block text-[12px] text-[#64748b]">
                    Payouts settle in devnet USDC
                  </span>
                </div>
                <span className="font-mono text-2xl font-bold tracking-tight text-[#020817]">
                  {formatMoney(total, preview.currency)}
                </span>
              </div>

              {/* Actions */}
              <div className="mt-6 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setReviewing(false)}
                  disabled={publishing}
                  className="rounded-full px-5 py-2.5 text-[14px] font-medium text-[#64748b] transition hover:bg-[#f1f0ec] hover:text-[#020817] disabled:opacity-60 cursor-pointer"
                >
                  Keep editing
                </button>
                <button
                  type="button"
                  onClick={submitListing}
                  disabled={publishing}
                  className="group inline-flex items-center gap-2 rounded-full bg-[#4166fb] px-7 py-3 text-[14px] font-semibold text-white shadow-[0_10px_25px_-6px_rgba(65,102,251,0.5)] transition hover:bg-[#3558e8] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                >
                  {publishing ? (
                    <>
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      <span>Submitting...</span>
                    </>
                  ) : (
                    <>
                      <span>Submit for review</span>
                      <ArrowRight size={16} className="transition-transform duration-150 group-hover:translate-x-0.5" />
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}

