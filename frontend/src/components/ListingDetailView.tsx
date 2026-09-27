'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Brush, Calendar, Trophy } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import SpecSheet from '@/components/SpecSheet'
import SellerAvatar from '@/components/SellerAvatar'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { deadlineLabel, formatMoney, isEnded, listingUrl, minBidFor, sellerDisplay, sellerUrl, surfaceLabels, type Spot } from '@/lib/listings'
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
  const { listings, getListing, claimSpot, placeBid, submitArtwork } = useStore()
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
  // Post-purchase artwork intake: which sold spot the hidden file input serves.
  const [artSpot, setArtSpot] = useState<string | null>(null)
  const [artBusy, setArtBusy] = useState(false)

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
        <Header />
        <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
          <h1 className="text-4xl">Space not found.</h1>
          <p className="text-[#64748b]">This listing does not exist or was removed.</p>
          <Link href="/browse" className="mt-2 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white">
            Back to browse
          </Link>
        </main>
        <Footer />
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
  const spotBidCount = (sp: Spot) => sp.bids?.length ?? (sp.bid != null ? 1 : 0)

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
    setName(x?.handle ?? '')
    setWebsite('')
    setLogo(null)
    setStep('brand')
    setPaying(false)
    setAmount(String(minBidFor(listing, spot)))
    setSuccess(null)
    setModal({ spot, mode: 'bid' })
  }

  const artClosed = !!listing.artworkClose && isEnded(listing.artworkClose)

  // Final artwork uploads at full quality (no shrink), capped at the API's ~3 MB.
  const onArtFile = (spotId: string, file: File | undefined) => {
    if (!file || artBusy) return
    if (!file.type.startsWith('image/')) {
      showToast('Artwork must be an image file.')
      return
    }
    if (file.size > 3 * 1024 * 1024) {
      showToast('Artwork must be under 3 MB.')
      return
    }
    setArtBusy(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/')) {
        showToast('Could not read that file.')
        setArtBusy(false)
        return
      }
      submitArtwork(listing.id, spotId, { logoUrl: dataUrl }).then(
        () => { setArtBusy(false); showToast('Artwork submitted.') },
        (e) => { setArtBusy(false); showToast(e instanceof Error ? e.message : 'Could not submit artwork.') },
      )
    }
    reader.onerror = () => {
      showToast('Could not read that file.')
      setArtBusy(false)
    }
    reader.readAsDataURL(file)
  }

  const shareUrl = (text: string) =>
    `https://x.com/intent/post?text=${encodeURIComponent(text + ` ${window.location.origin}${listingUrl(listing, listings)}`)}`

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
    const extras = {
      ...(logo ? { logoUrl: logo } : {}),
      ...(normalizeWebsite(website) ? { website: normalizeWebsite(website) } : {}),
    }
    // Mock checkout: visibly fake processing, then the same API-only mutation as before.
    setPaying(true)
    await new Promise((r) => setTimeout(r, 1200))
    try {
      if (modal.mode === 'claim') {
        await claimSpot(listing.id, modal.spot.id, actor, extras)
        setSuccess({ spotLabel: modal.spot.label, text: `${modal.spot.label} claimed by ${actor} — mock, no charge.` })
      } else {
        const amt = Number(amount)
        const min = minBidFor(listing, modal.spot)
        if (!amt || amt < min) {
          showToast(`Bid must be at least ${formatMoney(min, listing.currency)}.`)
          setPaying(false)
          return
        }
        await placeBid(listing.id, modal.spot.id, actor, amt, extras)
        setSuccess({ spotLabel: modal.spot.label, text: `${actor} bid ${formatMoney(amt, listing.currency)} on ${modal.spot.label} — mock.` })
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

  const back = backHref ?? '/browse'
  const backLabel = back === '/browse' ? 'Back to browse' : `Back to ${listing.seller.handle || listing.seller.name}`

  return (
    <>
      <Header />
      {PRIVY_ENABLED && <XProbe onChange={setX} />}
      <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">
        <Link href={back} className="mb-6 inline-flex items-center gap-[6px] text-sm font-medium text-[#64748b] transition hover:text-[#020817]">
          <ArrowLeft size={15} /> {backLabel}
        </Link>

        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-[#e9edfe] px-[10px] py-1 font-mono text-[11px] font-medium uppercase tracking-wide text-[#4166fb]">
              {surfaceLabels[listing.surface] ?? listing.surface}
            </span>
            <span className={`inline-flex items-center rounded-full px-3 py-[5px] font-mono text-[11px] font-medium uppercase tracking-wide ${isAuction ? 'bg-[#e9edfe] text-[#4166fb]' : 'bg-[#d1fae5] text-[#065f46]'}`}>
              {isAuction ? 'Live auction' : 'Fixed price'}
            </span>
            {countdown && (
              <span className="inline-flex items-center rounded-full bg-[#020817] px-3 py-[5px] font-mono text-[11px] font-medium uppercase tracking-wide text-white">
                {countdown}
              </span>
            )}
          </div>
          <h1 style={{ fontSize: 'clamp(30px, 4vw, 46px)' }}>{listing.title}</h1>
          <p className="mt-1 text-lg font-medium text-[#4166fb]">{listing.goal}</p>
          <p className="mt-3 text-[16px] text-[#64748b]">{listing.description}</p>
          <p className="mt-4 font-mono text-[13px] font-medium tracking-wide text-[#020817]">
            {takenCount}/{listing.spots.length} spots taken <span className="mx-1 text-[#e7e5e0]">·</span>
            <span className="text-[#64748b]">{allBids.length} bid{allBids.length === 1 ? '' : 's'}</span>
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#64748b]">
            <Link
              href={sellerUrl(listing.seller.handle || listing.seller.name)}
              className="inline-flex items-center gap-2 rounded-full transition hover:opacity-80"
            >
              <SellerAvatar seller={listing.seller} />
              <strong className="text-[#020817]">{sellerDisplay(listing.seller)}</strong>
            </Link>
            <span className="inline-flex items-center gap-[6px]"><Calendar size={14} /> {ended ? `Ended ${listing.deadline}` : `Ends ${listing.deadline}`}</span>
            {listing.artworkClose && (
              <span className="inline-flex items-center gap-[6px]"><Brush size={14} /> Artwork due {deadlineLabel(listing.artworkClose)}</span>
            )}
          </div>
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-[28px] font-semibold tracking-tight">
                {formatMoney(raised, listing.currency)} <span className="text-[16px] font-normal text-[#64748b]">raised</span>
              </p>
              <p className="font-mono text-[13px] text-[#64748b]">{takenCount}/{listing.spots.length} taken</p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#f1f0ec]" role="progressbar" aria-valuenow={takenCount} aria-valuemin={0} aria-valuemax={listing.spots.length} aria-label="Spots taken">
              <div
                className={`h-full rounded-full transition-all ${takenCount === listing.spots.length && listing.spots.length > 0 ? 'bg-[#16a34a]' : 'bg-[#4166fb]'}`}
                style={{ width: `${listing.spots.length ? Math.round((takenCount / listing.spots.length) * 100) : 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-5xl">
          <SpecSheet listing={listing} onClaim={ended ? () => showToast('This space has ended.') : openClaim} onBid={ended ? () => showToast('This space has ended.') : openBid} />
          <p className="mt-4 text-center text-sm text-[#64748b]">
            {ended ? 'This space has ended — no more claims or bids.' : <>Tap an open slot to {isAuction ? 'bid' : 'claim'} — your logo goes on the real thing.</>}
          </p>
        </div>

        {leaderboard.length > 0 && (
          <div className="mx-auto mt-10 max-w-5xl">
            <h2 className="mb-1 flex items-center gap-2 text-2xl"><Trophy size={20} className="text-[#b89b00]" /> Top brands.</h2>
            <p className="mb-4 text-sm text-[#64748b]">{allBids.length} bid{allBids.length === 1 ? '' : 's'} in total.</p>
            <div className="flex flex-col gap-2">
              {leaderboard.map((row, i) => (
                <div key={row.name} className="flex items-center gap-4 rounded-xl border border-[#e7e5e0] bg-white px-5 py-3 text-sm">
                  <span className="w-6 font-mono text-[13px] font-bold text-[#64748b]">{i + 1}</span>
                  <span className="font-semibold">{row.name}</span>
                  <span className="text-[#64748b]">{row.spots} spot{row.spots === 1 ? '' : 's'}</span>
                  <span className="ml-auto font-mono text-[13px] font-semibold">{formatMoney(row.total, listing.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mx-auto mt-10 max-w-5xl">
          <h2 className="mb-1 text-2xl">All spots.</h2>
          <p className="mb-4 text-sm text-[#64748b]">{takenCount} of {listing.spots.length} taken{ended ? ' — ended.' : <> — tap an open one to {isAuction ? 'bid' : 'claim'}.</>}</p>
          <div className="overflow-hidden rounded-2xl border border-[#e7e5e0] bg-white">
            {listing.spots.map((sp, i) => {
              const held = sp.claimedBy ?? sp.bidBy
              const open = !held
              return (
                <div key={sp.id} className={`flex items-center gap-3 px-5 py-3 text-sm ${i > 0 ? 'border-t border-[#e7e5e0]' : ''}`}>
                  <span className="w-6 shrink-0 font-mono text-[13px] text-[#64748b]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{sp.label}</span>
                  <span className="hidden shrink-0 rounded-full bg-[#f1f0ec] px-[10px] py-1 font-mono text-[11px] text-[#64748b] sm:inline">
                    {sp.size}
                  </span>
                  {held ? (
                    sp.website ? (
                      <span className="truncate text-[13px] text-[#64748b]">
                        <a href={normalizeWebsite(sp.website)} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#4166fb] hover:underline" onClick={(e) => e.stopPropagation()}>{held} ↗</a>
                        {' '}· {formatMoney(sp.bid ?? sp.price, listing.currency)}
                      </span>
                    ) : (
                      <span className="truncate text-[13px] text-[#64748b]">{held} · {formatMoney(sp.bid ?? sp.price, listing.currency)}</span>
                    )
                  ) : (
                    <span className="whitespace-nowrap font-mono text-[13px]">
                      {isAuction ? `from ${formatMoney(sp.price, listing.currency)}` : formatMoney(sp.price, listing.currency)}
                      {spotBidCount(sp) > 0 && <span className="text-[#64748b]"> · {spotBidCount(sp)} bid{spotBidCount(sp) === 1 ? '' : 's'}</span>}
                    </span>
                  )}
                  {open && !ended && (
                    <button
                      type="button"
                      onClick={() => (isAuction ? openBid(sp) : openClaim(sp))}
                      className="shrink-0 rounded-full bg-[#020817] px-4 py-2 text-[13px] font-medium text-white transition hover:bg-[#0f1a33]"
                    >
                      {isAuction ? 'Bid' : 'Claim'}
                    </button>
                  )}
                  {sp.sold && (sp.claimedBy ?? sp.bidBy) && (sp.claimedBy ?? sp.bidBy) === x?.handle && (
                    sp.artworkSubmittedAt
                      ? <span className="shrink-0 font-mono text-[11px] font-semibold text-[#16a34a]">ARTWORK IN ✓</span>
                      : artClosed
                        ? <span className="shrink-0 font-mono text-[11px] text-[#64748b]">ARTWORK CLOSED</span>
                        : <label htmlFor="artwork-file" onClick={() => setArtSpot(sp.id)} className="shrink-0 cursor-pointer rounded-full border border-[#4166fb] px-4 py-2 text-[13px] font-medium text-[#4166fb] transition hover:bg-[#e9edfe]">
                            {artBusy && artSpot === sp.id ? 'Sending…' : 'Submit artwork'}
                          </label>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <input
          id="artwork-file"
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload final artwork"
          onChange={(e) => { if (artSpot) onArtFile(artSpot, e.target.files?.[0]); e.target.value = '' }}
        />

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
                    <span className="text-[13px] font-semibold" id="modal-logo-label">Logo <span className="font-normal text-[#64748b]">(optional)</span></span>
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
                <p className="mt-4 text-center text-xs text-[#64748b]">Demo only — nothing is charged.</p>
              </>
            )}
            {modal && step === 'pay' && !success && (
              <>
                <h3 className="mb-1 text-2xl">Pay{modal.mode === 'claim' ? ` ${formatMoney(modal.spot.price, listing.currency)}` : ''}</h3>
                <p className="mb-6 text-sm text-[#64748b]">
                  {modal.spot.label} · {name || actor}{website.trim() ? ` · ${website.trim()}` : ''} — mock payment, no real charge.
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
                      {paying ? 'Paying (mock)…' : modal.mode === 'claim' ? 'Pay and claim' : 'Pay and bid'}
                    </button>
                  </div>
                </form>
                <p className="mt-4 text-center text-xs text-[#64748b]">Demo only — nothing is charged.</p>
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

      <Footer />
    </>
  )
}
