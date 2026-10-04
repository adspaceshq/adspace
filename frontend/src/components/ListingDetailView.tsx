'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Brush, Calendar, ExternalLink, Sparkles, Trophy } from 'lucide-react'
import Header from '@/components/Header'
import PageShell from '@/components/PageShell'
import SpecSheet from '@/components/SpecSheet'
import SellerAvatar from '@/components/SellerAvatar'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { deadlineLabel, expectedListingPayout, explorerTxUrl, formatMoney, isEnded, isSignatureLike, listingOversubscription, listingUrl, minBidFor, sellerDisplay, sellerUrl, type Spot } from '@/lib/listings'
import { PRIVY_ENABLED } from '@/lib/privy'

const field =
  'w-full rounded-lg border border-[#e7e5e0] bg-white px-[14px] py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition focus:border-[#4166fb] focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none'

function useCountdown(endsAt: string): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const ms = new Date(endsAt).getTime() - now
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'Ended'
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  return `${d}d ${h}h ${m}m ${s}s left`
}

function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function ListingDetailView({ id, backHref }: { id: string; backHref?: string }) {
  const { listings, getListing, claimSpot, placeBid, submitProof } = useStore()
  const listing = getListing(id)

  const [modal, setModal] = useState<{ spot: Spot; mode: 'claim' | 'bid' } | null>(null)
  const [success, setSuccess] = useState<{ spotLabel: string; text: string } | null>(null)
  const [name, setName] = useState('')
  const [website, setWebsite] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [step, setStep] = useState<'brand' | 'pay'>('brand')
  const [paying, setPaying] = useState(false)
  const [amount, setAmount] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [x, setX] = useState<XIdentity | null>(null)
  // Delivery proof (Step 9): seller-only form state per fulfilled spot.
  const [proofSpot, setProofSpot] = useState<string | null>(null)
  const [proofFiles, setProofFiles] = useState<string[]>([])
  const [proofPost, setProofPost] = useState('')
  const [proofBusy, setProofBusy] = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)

  // Brand site → clickable link. Bare domains get https:// so the link works.
  const normalizeWebsite = (raw: string) => {
    const v = raw.trim()
    if (!v) return ''
    return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`
  }

  // Shrink uploads to sticker size (max 256px) so the data URL always fits
  // the API's 100kb body limit. PNG first (keeps transparency), JPEG fallback.
  const logoDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      for (const size of [256, 128]) {
        const scale = Math.min(1, size / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) break
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const png = canvas.toDataURL('image/png')
        if (png.length <= 90_000) {
          resolve(png)
          return
        }
        const jpg = canvas.toDataURL('image/jpeg', 0.85)
        if (jpg.length <= 90_000 || size === 128) {
          resolve(jpg)
          return
        }
      }
      reject(new Error('could not shrink logo'))
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not read logo'))
    }
    img.src = url
  })

  const onLogoFile = (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      showToast('Logo must be an image file.')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      showToast('Logo must be under 2 MB.')
      return
    }
    logoDataUrl(file).then(setLogo, () => showToast('Could not read that file.'))
  }

  const countdown = useCountdown(listing?.endsAt ?? '')

  if (!listing) {
    return (
      <>
        <PageShell className="border-b-0 shadow-none">
          <Header />
          <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
            <h1 className="text-4xl">Space not found.</h1>
            <p className="text-[#64748b]">This listing does not exist or was removed.</p>
            <Link href="/browse" className="mt-2 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white">
              Back to browse
            </Link>
          </main>
        </PageShell>
      </>
    )
  }

  const isAuction = listing.priceType === 'auction'
  const ended = isEnded(listing.endsAt)
  const raised = listing.spots.reduce((a, s) => a + (s.bid ?? 0), 0)
  const allBids = listing.spots.flatMap((sp) =>
    (sp.bids ?? []).map((b) => ({ ...b, spotLabel: sp.label }))
  ).sort((a, b) => +new Date(b.at) - +new Date(a.at))
  const totals = new Map<string, number>()
  for (const b of allBids) totals.set(b.bidder, (totals.get(b.bidder) ?? 0) + b.amount)
  const leaders = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
  const leaderboard = leaders.map(([name, total]) => ({
    name,
    total,
    spots: new Set(allBids.filter((b) => b.bidder === name).map((b) => b.spotLabel)).size,
  }))
  const takenCount = listing.spots.filter((s) => s.claimedBy || s.bidBy).length
  const sponsoredSpots = listing.spots.filter((s) => Boolean(s.claimedBy || s.bidBy))
  const openSpots = listing.spots.filter((s) => !s.claimedBy && !s.bidBy)
  const demand = listingOversubscription(listing)
  const expectedPayout = expectedListingPayout(listing)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }

  const openClaim = (spot: Spot) => {
    setName(x?.handle ?? '')
    setWebsite('')
    setLogo(null)
    setStep('brand')
    setPaying(false)
    setSuccess(null)
    setModal({ spot, mode: 'claim' })
  }
  const openBid = (spot: Spot) => {
    if (listing && x?.handle && normHandle(x.handle) === normHandle(listing.seller.handle || listing.seller.name)) {
      showToast('You cannot bid on your own listing.')
      return
    }
    if (x?.handle && spot.bidBy && normHandle(x.handle) === normHandle(spot.bidBy)) {
      showToast('You already hold the top bid.')
      return
    }
    setName(x?.handle ?? '')
    setWebsite('')
    setLogo(null)
    setStep('brand')
    setPaying(false)
    setAmount(String(minBidFor(listing, spot)))
    setSuccess(null)
    setModal({ spot, mode: 'bid' })
  }

  const shareUrl = (text: string) =>
    `https://x.com/intent/post?text=${encodeURIComponent(text + ` ${window.location.origin}${listingUrl(listing, listings)}`)}`

  const normHandle = (h: string) => h.trim().replace(/^@+/, '').toLowerCase()
  const isOwner = !!x?.handle && normHandle(x.handle) === normHandle(listing.seller.handle || listing.seller.name)

  // Proof photos upload at full quality (no shrink), capped at the API's ~3 MB each.
  const onProofFiles = (files: FileList | null) => {
    if (!files || proofBusy) return
    const picked = Array.from(files).slice(0, 5 - proofFiles.length)
    if (!picked.length) {
      showToast('At most 5 proof photos.')
      return
    }
    setProofBusy(true)
    setProofError(null)
    Promise.all(picked.map((file) => new Promise<string>((resolve, reject) => {
      if (!file.type.startsWith('image/')) reject(new Error('Proof photos must be image files.'))
      else if (file.size > 3 * 1024 * 1024) reject(new Error('Proof photos must be under 3 MB each.'))
      else {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : ''
          if (dataUrl.startsWith('data:image/')) resolve(dataUrl)
          else reject(new Error('Could not read that file.'))
        }
        reader.onerror = () => reject(new Error('Could not read that file.'))
        reader.readAsDataURL(file)
      }
    }))).then(
      (dataUrls) => { setProofFiles((prev) => [...prev, ...dataUrls].slice(0, 5)); setProofBusy(false) },
      (e) => { setProofBusy(false); setProofError(e instanceof Error ? e.message : 'Could not read those files.') },
    )
  }

  const saveProof = async (spotId: string) => {
    if (!proofFiles.length) {
      setProofError('Add at least one photo.')
      return
    }
    setProofBusy(true)
    setProofError(null)
    try {
      await submitProof(listing.id, spotId, { photos: proofFiles, ...(proofPost.trim() ? { postUrl: proofPost.trim() } : {}) })
      setProofSpot(null)
      setProofFiles([])
      setProofPost('')
      showToast('Proof uploaded.')
    } catch (e) {
      setProofError(e instanceof Error ? e.message : 'Could not upload proof.')
    } finally {
      setProofBusy(false)
    }
  }

  // Actor: verified X handle when Privy is configured, manual name in demo mode.
  const actor = PRIVY_ENABLED ? (x?.handle ?? '') : name.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal || paying) return
    if (PRIVY_ENABLED) {
      if (!x?.ready || x.loggingIn) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    if (!actor) return
    if (!logo) {
      showToast('Add your logo — every spot carries art.')
      setStep('brand')
      return
    }
    const extras = {
      ...(logo ? { logoUrl: logo } : {}),
      ...(normalizeWebsite(website) ? { website: normalizeWebsite(website) } : {}),
    }
    // On-chain when the backend is configured for chain (devnet USDC moves),
    // spot-marking fallback otherwise — same API-only mutation either way.
    setPaying(true)
    try {
      if (modal.mode === 'claim') {
        await claimSpot(listing.id, modal.spot.id, actor, extras)
        setSuccess({ spotLabel: modal.spot.label, text: `${modal.spot.label} claimed by ${actor}.` })
      } else {
        const amt = Number(amount)
        const min = minBidFor(listing, modal.spot)
        if (!amt || amt < min) {
          showToast(`Bid must be at least ${formatMoney(min, listing.currency)}.`)
          setPaying(false)
          return
        }
        await placeBid(listing.id, modal.spot.id, actor, amt, extras)
        setSuccess({ spotLabel: modal.spot.label, text: `${actor} bid ${formatMoney(amt, listing.currency)} on ${modal.spot.label}.` })
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong.')
      setPaying(false)
      return
    }
    setPaying(false)
    setModal(null)
  }

  // Brand step → pay step. Login first when Privy is on, same rule as submit.
  const continueToPay = (e: React.FormEvent) => {
    e.preventDefault()
    if (PRIVY_ENABLED) {
      if (!x?.ready || x.loggingIn) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    if (!actor) return
    setStep('pay')
  }

  const cleanStory = (() => {
    const desc = listing.description?.replace(/\s*\(Artwork due.*?\)\.?\s*$/i, '').trim()
    if (desc && !desc.toLowerCase().startsWith('(artwork due')) return desc
    if (listing.goal && !listing.goal.toLowerCase().startsWith('(artwork due') && listing.goal.trim() !== 'Fund my goal') {
      return listing.goal.trim()
    }
    return null
  })()

  return (
    <>
      <PageShell className="border-b-0 shadow-none">
        <Header />
        {PRIVY_ENABLED && <XProbe onChange={setX} />}
        <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">

        <div className="mx-auto max-w-3xl">
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }} className="font-bold tracking-tight text-[#020817]">
            {listing.title}
          </h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-[#64748b]">
            <Link
              href={sellerUrl(listing.seller.handle || listing.seller.name)}
              className="inline-flex items-center gap-2 rounded-full transition hover:opacity-80"
            >
              <SellerAvatar seller={listing.seller} />
              <strong className="text-[#020817]">{sellerDisplay(listing.seller)}</strong>
            </Link>
            <span className="text-[#cbd5e1]">·</span>
            <span className="inline-flex items-center gap-[6px]">
              <Calendar size={14} />
              <span>{ended ? `Ended ${listing.deadline}` : `Ends ${listing.deadline}`}</span>
            </span>
            {countdown && !ended && (
              <span className="inline-flex items-center rounded-full bg-[#020817] px-2.5 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wide text-white">
                {countdown}
              </span>
            )}
            {listing.artworkClose && (
              <>
                <span className="text-[#cbd5e1]">·</span>
                <span className="inline-flex items-center gap-[6px]">
                  <Brush size={14} />
                  <span>Artwork due {deadlineLabel(listing.artworkClose)}</span>
                </span>
              </>
            )}
          </div>

          {cleanStory && (
            <p className="mt-3 text-[15px] leading-relaxed text-[#526079]">{cleanStory}</p>
          )}

          <div className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <p className="text-[28px] font-semibold tracking-tight text-[#020817]">
                {formatMoney(raised, listing.currency)} <span className="text-[16px] font-normal text-[#64748b]">raised</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#64748b]">
                <span className="font-medium text-[#020817]">{takenCount}/{listing.spots.length} spots taken</span>
                <span className="text-[#cbd5e1]">·</span>
                <span>{allBids.length} bid{allBids.length === 1 ? '' : 's'}</span>
                {isAuction && demand.percent > 0 && (
                  <>
                    <span className="text-[#cbd5e1]">·</span>
                    <span className="font-semibold text-[#9a3412]">+{demand.percent}% oversubscribed</span>
                  </>
                )}
              </div>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e7e5e0]" role="progressbar" aria-valuenow={takenCount} aria-valuemin={0} aria-valuemax={listing.spots.length} aria-label="Spots taken">
              <div
                className={`h-full rounded-full transition-all duration-300 ${takenCount === listing.spots.length && listing.spots.length > 0 ? 'bg-[#16a34a]' : 'bg-[#4166fb]'}`}
                style={{ width: `${listing.spots.length ? Math.round((takenCount / listing.spots.length) * 100) : 0}%` }}
              />
            </div>
          </div>
          {isOwner && (
            <section aria-label="Expected seller payout" className="mt-5 rounded-2xl border border-[#dbe3ff] bg-[#f5f7ff] p-5 text-left">
              <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
                <div>
                  <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-[#4166fb]">Seller estimate</p>
                  <p className="mt-1 text-sm text-[#64748b]">Updates with every winning bid. Final payout follows settlement and dispute review.</p>
                </div>
                <p className="shrink-0 text-[28px] font-semibold tracking-tight">{formatMoney(expectedPayout.net, listing.currency)}</p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-[#dbe3ff] pt-4 text-sm sm:grid-cols-3">
                <div><dt className="text-[#64748b]">Gross committed</dt><dd className="mt-1 font-mono font-semibold">{formatMoney(expectedPayout.gross, listing.currency)}</dd></div>
                <div><dt className="text-[#64748b]">Estimated platform fee</dt><dd className="mt-1 font-mono font-semibold">-{formatMoney(expectedPayout.fee, listing.currency)}</dd></div>
                <div className="col-span-2 sm:col-span-1"><dt className="text-[#64748b]">Expected payout</dt><dd className="mt-1 font-mono font-semibold text-[#16a34a]">{formatMoney(expectedPayout.net, listing.currency)}</dd></div>
              </dl>
            </section>
          )}
        </div>

        <div className="mx-auto mt-8 max-w-5xl">
          <SpecSheet
            listing={listing}
            hideFooter
            onClaim={ended ? () => showToast('This space has ended.') : openClaim}
            onBid={ended ? () => showToast('This space has ended.') : openBid}
          />
        </div>

        <div className="mx-auto mt-12 max-w-5xl">
          <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-normal tracking-tight text-[#020817]">Participating brands.</h2>
              <p className="text-sm text-[#64748b]">
                {sponsoredSpots.length === 0
                  ? 'No brands have placed their stickers yet.'
                  : `${sponsoredSpots.length} spot${sponsoredSpots.length === 1 ? '' : 's'} claimed or active on this space.`}
              </p>
            </div>
            {listing.spots.length > 0 && (
              <span className="font-mono text-xs text-[#64748b]">
                {sponsoredSpots.length}/{listing.spots.length} SPOTS TAKEN
              </span>
            )}
          </div>

          {sponsoredSpots.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[#d8d6d0] bg-white p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#f8fafc] text-[#4166fb]">
                <Sparkles size={22} />
              </div>
              <h3 className="text-base font-semibold text-[#020817]">No brands on this canvas yet</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-[#64748b]">
                Be the first brand to place your sticker and reach {sellerDisplay(listing.seller)}&apos;s audience.
              </p>
              {!ended && listing.spots.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const first = listing.spots.find((s) => !s.claimedBy && !s.bidBy) ?? listing.spots[0]
                    if (first) {
                      if (isAuction) openBid(first)
                      else openClaim(first)
                    }
                  }}
                  className="mt-4 inline-flex items-center rounded-full bg-[#020817] px-5 py-2.5 text-xs font-medium text-white transition hover:bg-[#0f1a33]"
                >
                  {isAuction ? 'Place a bid' : 'Claim a spot'}
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {sponsoredSpots.map((sp) => {
                const brand = sp.claimedBy || sp.bidBy || 'Anonymous'
                const isClaimed = Boolean(sp.claimedBy)
                const amount = sp.bid ?? sp.price
                const websiteClean = sp.website ? sp.website.replace(/^https?:\/\//i, '').replace(/\/$/, '') : null

                return (
                  <div
                    key={sp.id}
                    className="flex items-center gap-4 rounded-2xl border border-[#e7e5e0] bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.03)] transition hover:border-[#cbd5e1]"
                  >
                    {/* Brand Sticker / Logo */}
                    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#e7e5e0] bg-[#fafaf7] p-1.5">
                      {sp.logoImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sp.logoImage}
                          alt={`${brand} sticker`}
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <div
                          className="flex h-full w-full items-center justify-center rounded-lg font-mono text-base font-bold text-white"
                          style={{ background: sp.logoColor || '#3b82f6' }}
                        >
                          {brand.replace(/^@/, '').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                    </div>

                    {/* Brand details */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-[#020817]">{brand}</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            isClaimed
                              ? 'bg-[#ecfdf5] text-[#16a34a]'
                              : 'bg-[#eef2ff] text-[#4166fb]'
                          }`}
                        >
                          {isClaimed ? 'Claimed' : 'Top bid'}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-[#64748b]">
                        <span>{sp.label}</span>
                        {sp.size && <span>· {sp.size}</span>}
                        {websiteClean && (
                          <>
                            <span>·</span>
                            <a
                              href={normalizeWebsite(sp.website!)}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 font-medium text-[#4166fb] hover:underline"
                            >
                              {websiteClean}
                              <ExternalLink size={11} className="shrink-0" />
                            </a>
                          </>
                        )}
                      </div>

                      {sp.chainTransaction && (
                        <div className="mt-1">
                          <a
                            href={explorerTxUrl(sp.chainTransaction)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 font-mono text-[11px] text-[#94a3b8] hover:text-[#4166fb]"
                          >
                            On-chain verified ↗
                          </a>
                        </div>
                      )}
                    </div>

                    {/* Funding / Price */}
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-base font-semibold text-[#020817]">
                        {formatMoney(amount, listing.currency)}
                      </div>
                      <div className="text-[11px] text-[#64748b]">
                        {isAuction ? 'current bid' : 'fixed'}
                      </div>
                    </div>
                  </div>
                )
              })}

              {/* If there are open spots and space is not ended, show an inviting spot card */}
              {!ended && openSpots.length > 0 && (
                <div
                  onClick={() => {
                    const first = openSpots[0]
                    if (isAuction) openBid(first)
                    else openClaim(first)
                  }}
                  className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-[#d8d6d0] bg-[#fafaf7]/60 p-4 transition hover:border-[#4166fb] hover:bg-white"
                >
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-dashed border-[#cbd5e1] bg-white text-[#94a3b8]">
                    <Sparkles size={20} className="text-[#4166fb]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-[#020817]">
                      {openSpots.length} spot{openSpots.length === 1 ? '' : 's'} still open
                    </p>
                    <p className="mt-0.5 text-xs text-[#64748b]">
                      Tap to put your brand sticker on this {listing.surface || 'item'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="inline-flex items-center rounded-full bg-[#020817] px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-[#0f1a33]">
                      {isAuction ? 'Bid' : 'Claim'}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>



        {(() => {
          const proven = listing.spots.filter((s) => s.proofPhotos?.length)
          const pending = isOwner ? listing.spots.filter((s) => s.fulfilledAt && !s.proofPhotos?.length) : []
          if (!proven.length && !pending.length) return null
          const openForm = (sp: Spot) => {
            setProofSpot(sp.id)
            setProofFiles(sp.proofPhotos ? [...sp.proofPhotos] : [])
            setProofPost(sp.proofPost ?? '')
            setProofError(null)
          }
          const form = (sp: Spot) => (
            <div className="mt-3 rounded-xl bg-[#f6f6f4] p-4">
              {proofFiles.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-2">
                  {proofFiles.map((src, i) => (
                    <span key={i} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt="" className="h-20 w-20 rounded-lg border border-[#e7e5e0] object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => setProofFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="absolute -right-2 -top-2 grid h-5 w-5 place-items-center rounded-full bg-[#020817] text-[11px] text-white"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3">
                <label htmlFor={`proof-file-${sp.id}`} className="cursor-pointer rounded-full border border-[#e7e5e0] bg-white px-4 py-2 text-[13px] font-medium transition hover:border-[#4166fb]">
                  {proofBusy ? 'Reading…' : 'Add photos'}
                </label>
                <input
                  id={`proof-file-${sp.id}`}
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => { onProofFiles(e.target.files); e.target.value = '' }}
                />
                <input
                  value={proofSpot === sp.id ? proofPost : ''}
                  onChange={(e) => setProofPost(e.target.value)}
                  placeholder="x.com/… post link (optional)"
                  spellCheck={false}
                  className="min-w-[200px] flex-1 rounded-lg border border-[#e7e5e0] bg-white px-3 py-2 text-[13px] outline-none transition focus:border-[#4166fb]"
                />
                <button
                  type="button"
                  onClick={() => void saveProof(sp.id)}
                  disabled={proofBusy || !proofFiles.length}
                  className="rounded-full bg-[#020817] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
                >
                  {proofBusy ? 'Uploading…' : 'Upload proof'}
                </button>
                <button
                  type="button"
                  onClick={() => { setProofSpot(null); setProofFiles([]); setProofPost(''); setProofError(null) }}
                  className="text-[13px] font-medium text-[#64748b] transition hover:text-[#020817]"
                >
                  Cancel
                </button>
              </div>
              {proofError && proofSpot === sp.id && <p className="mt-2 text-[13px] text-[#dc2626]">{proofError}</p>}
            </div>
          )
          return (
            <div className="mx-auto mt-10 max-w-5xl">
              <h2 className="mb-1 text-2xl">Proof of delivery.</h2>
              <p className="mb-4 text-sm text-[#64748b]">Photos from the finished campaign, pinned by the seller.</p>
              <div className="flex flex-col gap-3">
                {proven.map((sp) => (
                  <div key={sp.id} className="rounded-2xl border border-[#e7e5e0] bg-white px-5 py-4">
                    <p className="text-sm font-semibold">{sp.label} <span className="font-normal text-[#64748b]">· {sp.claimedBy ?? sp.bidBy}</span></p>
                    <div className="mt-3 flex flex-wrap gap-3">
                      {sp.proofPhotos!.map((src, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={i} src={src} alt={`${sp.label} proof ${i + 1}`} className="h-28 w-28 rounded-xl border border-[#e7e5e0] object-cover" />
                      ))}
                    </div>
                    {sp.proofPost && (
                      <a href={sp.proofPost} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-[13px] font-semibold text-[#4166fb] hover:underline">
                        View the X post ↗
                      </a>
                    )}
                    {isOwner && (proofSpot === sp.id ? form(sp) : (
                      <button type="button" onClick={() => openForm(sp)} className="mt-3 text-[13px] font-medium text-[#64748b] transition hover:text-[#020817]">
                        Replace proof
                      </button>
                    ))}
                  </div>
                ))}
                {pending.map((sp) => (
                  <div key={sp.id} className="rounded-2xl border border-dashed border-[#d8d6d0] bg-white px-5 py-4">
                    <p className="text-sm font-semibold">{sp.label} <span className="font-normal text-[#64748b]">· delivered, no proof yet</span></p>
                    {proofSpot === sp.id ? form(sp) : (
                      <button type="button" onClick={() => openForm(sp)} className="mt-3 inline-flex items-center rounded-full bg-[#020817] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#0f1a33]">
                        Add proof
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {allBids.length > 0 && (
          <div className="mx-auto mt-10 max-w-5xl">
            <h2 className="mb-4 text-2xl">Latest bids.</h2>
            <div className="flex flex-col gap-2">
              {allBids.slice(0, 6).map((b, i) => (
                <div key={`${b.at}-${i}`} className="flex items-center gap-3 rounded-xl border border-[#e7e5e0] bg-white px-5 py-3 text-sm">
                  <span className="font-semibold">{b.bidder}</span>
                  <span className="text-[#64748b]">bid {formatMoney(b.amount, listing.currency)} on {b.spotLabel}</span>
                  <span className="ml-auto text-[13px] text-[#64748b]">{ago(b.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
      </PageShell>

      {(modal || success) && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#020817]/55 p-6 backdrop-blur-sm" onClick={() => { setModal(null); setSuccess(null); setPaying(false) }}>
          <div className="w-full max-w-[440px] rounded-2xl bg-white p-8 shadow-[0_16px_40px_rgba(2,8,23,0.1)]" onClick={(e) => e.stopPropagation()}>
            {success ? (
              <>
                <h3 className="mb-1 text-2xl">You&apos;re in.</h3>
                <p className="mb-6 text-sm text-[#64748b]">{success.text}</p>
                <div className="flex justify-end gap-3">
                  <a
                    href={shareUrl(success.text)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-[#e7e5e0] px-[22px] py-[13px] text-[15px] font-medium transition hover:bg-[#f1f0ec]"
                  >
                    Share on X
                  </a>
                  <button
                    onClick={() => setSuccess(null)}
                    className="rounded-full bg-[#4166fb] px-[22px] py-[13px] text-[15px] font-medium text-white transition hover:bg-[#3558e8]"
                  >
                    Done
                  </button>
                </div>
              </>
            ) : modal && step === 'brand' && (
              <>
                <h3 className="mb-1 text-2xl">{modal.mode === 'claim' ? 'Claim' : 'Bid on'} {modal.spot.label}</h3>
                <p className="mb-6 text-sm text-[#64748b]">
                  {modal.mode === 'claim'
                    ? `${formatMoney(modal.spot.price, listing.currency)} fixed — your brand goes on the real thing.`
                    : `current ${formatMoney(modal.spot.bid ?? modal.spot.price, listing.currency)} — your brand goes on the real thing.`}
                </p>
                <form onSubmit={continueToPay}>
                  {PRIVY_ENABLED ? (
                    <div className="mb-5 rounded-xl border border-[#e7e5e0] bg-[#fafaf7] px-[14px] py-3 text-[14px]">
                      {x?.authenticated && x.handle ? (
                        <span className="flex items-center gap-2">
                          {x.avatar ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={x.avatar} alt="" width={24} height={24} className="h-6 w-6 rounded-full object-cover" />
                          ) : null}
                          <span>{modal.mode === 'claim' ? 'Claiming' : 'Bidding'} as <strong>{x.handle}</strong></span>
                        </span>
                      ) : (
                        <span className="text-[#64748b]">
                          Log in with X to {modal.mode === 'claim' ? 'claim' : 'bid'} — your handle is your identity.
                          {x?.error && <span className="mt-1 block text-[#dc2626]">{x.error}</span>}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="mb-5 flex flex-col gap-[6px]">
                      <label className="text-[13px] font-semibold" htmlFor="modal-name">X handle</label>
                      <input
                        id="modal-name" required value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="@acme" className={field} autoFocus
                      />
                    </div>
                  )}
                  <div className="mb-5 flex flex-col gap-[6px]">
                    <label className="text-[13px] font-semibold" htmlFor="modal-website">Website <span className="font-normal text-[#64748b]">(optional)</span></label>
                    <input
                      id="modal-website" type="text" inputMode="url" value={website} onChange={(e) => setWebsite(e.target.value)}
                      placeholder="acme.com" className={field}
                    />
                  </div>
                  <div className="mb-5 flex flex-col gap-[6px]">
                    <span className="text-[13px] font-semibold" id="modal-logo-label">Logo <span className="font-normal text-[#64748b]">(required — it goes on the real thing)</span></span>
                    <div className="flex items-center gap-3">
                      {logo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={logo} alt="Logo preview" className="h-12 w-12 shrink-0 rounded-xl border border-[#e7e5e0] object-cover" />
                      )}
                      <label htmlFor="modal-logo" className="cursor-pointer rounded-full border border-[#e7e5e0] px-[18px] py-[10px] text-[14px] font-medium transition hover:bg-[#f1f0ec]">
                        {logo ? 'Replace logo' : 'Upload logo'}
                      </label>
                      <input
                        id="modal-logo" type="file" accept="image/*" className="sr-only"
                        aria-labelledby="modal-logo-label"
                        onChange={(e) => { onLogoFile(e.target.files?.[0]); e.target.value = '' }}
                      />
                      {logo && (
                        <button type="button" onClick={() => setLogo(null)} className="text-[13px] font-medium text-[#dc2626] transition hover:text-[#991b1b]">
                          Remove
                        </button>
                      )}
                    </div>
                    <p className="text-[12px] text-[#64748b]">Shows on your sticker right away. Auto-shrunk to fit.</p>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={() => setModal(null)} className="rounded-full border border-[#e7e5e0] px-[22px] py-[13px] text-[15px] font-medium transition hover:bg-[#f1f0ec]">
                      Cancel
                    </button>
                    <button type="submit" className="rounded-full bg-[#4166fb] px-[22px] py-[13px] text-[15px] font-medium text-white transition hover:bg-[#3558e8]">
                      {PRIVY_ENABLED && (!x?.authenticated || !x.handle)
                        ? (x?.loggingIn ? 'Redirecting…' : 'Log in with X')
                        : 'Continue to pay'}
                    </button>
                  </div>
                </form>
                <p className="mt-4 text-center text-xs text-[#64748b]">Devnet USDC — no mainnet funds move.</p>
              </>
            )}
            {modal && step === 'pay' && !success && (
              <>
                <h3 className="mb-1 text-2xl">Pay{modal.mode === 'claim' ? ` ${formatMoney(modal.spot.price, listing.currency)}` : ''}</h3>
                <p className="mb-6 text-sm text-[#64748b]">
                  {modal.spot.label} · {name || actor}{website.trim() ? ` · ${website.trim()}` : ''} — devnet USDC payment.
                </p>
                <form onSubmit={submit}>
                  {modal.mode === 'bid' && (
                    <div className="mb-5 flex flex-col gap-[6px]">
                      <label className="text-[13px] font-semibold" htmlFor="modal-amount">
                        Bid (min {formatMoney(minBidFor(listing, modal.spot), listing.currency)})
                      </label>
                      <input
                        id="modal-amount" required type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                        min={minBidFor(listing, modal.spot)} className={field} autoFocus
                      />
                    </div>
                  )}
                  <div className="mb-5 flex items-center justify-between rounded-xl border border-[#e7e5e0] bg-[#fafaf7] px-[14px] py-3 text-[14px]">
                    <span className="text-[#64748b]">{modal.mode === 'claim' ? 'Fixed price' : 'Your bid'}</span>
                    <span className="font-mono font-semibold">
                      {modal.mode === 'claim'
                        ? formatMoney(modal.spot.price, listing.currency)
                        : (Number(amount) > 0 ? formatMoney(Number(amount), listing.currency) : '—')}
                    </span>
                  </div>
                  <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={() => !paying && setStep('brand')} disabled={paying} className="rounded-full border border-[#e7e5e0] px-[22px] py-[13px] text-[15px] font-medium transition hover:bg-[#f1f0ec] disabled:opacity-60">
                      Back
                    </button>
                    <button type="submit" disabled={paying} className="rounded-full bg-[#4166fb] px-[22px] py-[13px] text-[15px] font-medium text-white transition hover:bg-[#3558e8] disabled:opacity-60">
                      {paying ? 'Paying…' : modal.mode === 'claim' ? 'Pay and claim' : 'Pay and bid'}
                    </button>
                  </div>
                </form>
                <p className="mt-4 text-center text-xs text-[#64748b]">Devnet USDC — no mainnet funds move.</p>
              </>
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[110] max-w-[90vw] -translate-x-1/2 rounded-full bg-[#020817] px-[22px] py-[14px] text-center text-sm font-medium text-white shadow-[0_16px_40px_rgba(2,8,23,0.1)]">
          {toast}
        </div>
      )}
    </>
  )
}
