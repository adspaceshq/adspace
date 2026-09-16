'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Calendar, Trophy } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import SpecSheet from '@/components/SpecSheet'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { formatMoney, surfaceLabels, type Spot } from '@/lib/listings'

// True once the new Privy App ID lands in frontend/.env.local.
// When false the page falls back to the logged-out demo (manual name).
const PRIVY_ENABLED = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID

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
  if (ms <= 0) return 'Closed'
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

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { getListing, claimSpot, placeBid } = useStore()
  const listing = getListing(id)

  const [modal, setModal] = useState<{ spot: Spot; mode: 'claim' | 'bid' } | null>(null)
  const [success, setSuccess] = useState<{ spotLabel: string; text: string } | null>(null)
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [x, setX] = useState<XIdentity | null>(null)

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
  const raised = listing.spots.reduce((a, s) => a + (s.bid ?? 0), 0)
  const allBids = listing.spots.flatMap((sp) =>
    (sp.bids ?? []).map((b) => ({ ...b, spotLabel: sp.label }))
  ).sort((a, b) => +new Date(b.at) - +new Date(a.at))
  const totals = new Map<string, number>()
  for (const b of allBids) totals.set(b.bidder, (totals.get(b.bidder) ?? 0) + b.amount)
  const leaders = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 3200)
  }

  const openClaim = (spot: Spot) => {
    setName('')
    setSuccess(null)
    setModal({ spot, mode: 'claim' })
  }
  const openBid = (spot: Spot) => {
    setName('')
    setAmount(String((spot.bid ?? spot.price) + (spot.bid ? 10 : 0)))
    setSuccess(null)
    setModal({ spot, mode: 'bid' })
  }

  const shareUrl = (text: string) =>
    `https://x.com/intent/post?text=${encodeURIComponent(text + ` ${window.location.origin}/listings/${listing.id}`)}`

  // Actor: verified X handle when Privy is configured, manual name in demo mode.
  const actor = PRIVY_ENABLED ? (x?.handle ?? '') : name.trim()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!modal) return
    if (PRIVY_ENABLED) {
      if (!x?.ready) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    if (!actor) return
    try {
      if (modal.mode === 'claim') {
        await claimSpot(listing.id, modal.spot.id, actor)
        setSuccess({ spotLabel: modal.spot.label, text: `${modal.spot.label} claimed by ${actor} — mock, no charge.` })
      } else {
        const amt = Number(amount)
        const min = (modal.spot.bid ?? modal.spot.price) + (modal.spot.bid ? 10 : 0)
        if (!amt || amt < min) {
          showToast(`Bid must be at least ${formatMoney(min)}.`)
          return
        }
        await placeBid(listing.id, modal.spot.id, actor, amt)
        setSuccess({ spotLabel: modal.spot.label, text: `${actor} bid ${formatMoney(amt)} on ${modal.spot.label} — mock.` })
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Something went wrong.')
      return
    }
    setModal(null)
  }

  return (
    <>
      <Header />
      {PRIVY_ENABLED && <XProbe onChange={setX} />}
      <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">
        <Link href="/browse" className="mb-6 inline-flex items-center gap-[6px] text-sm font-medium text-[#64748b] transition hover:text-[#020817]">
          <ArrowLeft size={15} /> Back to browse
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
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#64748b]">
            <span className="inline-flex items-center gap-2">
              <span
                className="grid h-6 w-6 place-items-center rounded-full text-xs font-semibold text-white"
                style={{ background: listing.seller.color }}
              >
                {listing.seller.name.charAt(0)}
              </span>
              <strong className="text-[#020817]">{listing.seller.name}</strong> {listing.seller.handle}
            </span>
            <span className="inline-flex items-center gap-[6px]"><Calendar size={14} /> Ends {listing.deadline}</span>
            <span><strong className="text-[#020817]">{formatMoney(raised)}</strong> raised</span>
            {leaders.length > 0 && (
              <span className="inline-flex items-center gap-[6px]">
                <Trophy size={14} className="text-[#b89b00]" />
                {leaders.map(([n, t], i) => (
                  <span key={n}>{i > 0 && '· '}<strong className="text-[#020817]">{n}</strong> {formatMoney(t)}</span>
                ))}
              </span>
            )}
          </div>
        </div>

        <div className="mx-auto mt-8 max-w-5xl">
          <SpecSheet listing={listing} onClaim={openClaim} onBid={openBid} />
          <p className="mt-4 text-center text-sm text-[#64748b]">
            Tap an open slot to {isAuction ? 'bid' : 'claim'} — your logo goes on the real thing.
          </p>
        </div>

        {allBids.length > 0 && (
          <div className="mx-auto mt-10 max-w-5xl">
            <h2 className="mb-4 text-2xl">Latest bids.</h2>
            <div className="flex flex-col gap-2">
              {allBids.slice(0, 6).map((b, i) => (
                <div key={`${b.at}-${i}`} className="flex items-center gap-3 rounded-xl border border-[#e7e5e0] bg-white px-5 py-3 text-sm">
                  <span className="font-semibold">{b.bidder}</span>
                  <span className="text-[#64748b]">bid {formatMoney(b.amount)} on {b.spotLabel}</span>
                  <span className="ml-auto text-[13px] text-[#64748b]">{ago(b.at)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {(modal || success) && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-[#020817]/55 p-6 backdrop-blur-sm" onClick={() => { setModal(null); setSuccess(null) }}>
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
            ) : modal && (
              <>
                <h3 className="mb-1 text-2xl">{modal.mode === 'claim' ? 'Claim' : 'Bid on'} {modal.spot.label}</h3>
                <p className="mb-6 text-sm text-[#64748b]">
                  {modal.spot.size} · {modal.mode === 'claim'
                    ? `${formatMoney(modal.spot.price)} fixed — mock checkout, no charge.`
                    : `current ${formatMoney(modal.spot.bid ?? modal.spot.price)} — mock bid.`}
                </p>
                <form onSubmit={submit}>
                  {PRIVY_ENABLED ? (
                    <div className="mb-5 rounded-xl border border-[#e7e5e0] bg-[#fafaf7] px-[14px] py-3 text-[14px]">
                      {x?.authenticated && x.handle ? (
                        <span>Claiming as <strong>{x.handle}</strong></span>
                      ) : (
                        <span className="text-[#64748b]">Log in with X to {modal.mode === 'claim' ? 'claim' : 'bid'} — your handle is your identity.</span>
                      )}
                    </div>
                  ) : (
                    <div className="mb-5 flex flex-col gap-[6px]">
                      <label className="text-[13px] font-semibold" htmlFor="modal-name">Your name or brand</label>
                      <input
                        id="modal-name" required value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="Acme" className={field} autoFocus
                      />
                    </div>
                  )}
                  {modal.mode === 'bid' && (
                    <div className="mb-5 flex flex-col gap-[6px]">
                      <label className="text-[13px] font-semibold" htmlFor="modal-amount">
                        Bid (min {formatMoney((modal.spot.bid ?? modal.spot.price) + (modal.spot.bid ? 10 : 0))})
                      </label>
                      <input
                        id="modal-amount" required type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                        min={(modal.spot.bid ?? modal.spot.price) + (modal.spot.bid ? 10 : 0)} className={field}
                      />
                    </div>
                  )}
                  <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={() => setModal(null)} className="rounded-full border border-[#e7e5e0] px-[22px] py-[13px] text-[15px] font-medium transition hover:bg-[#f1f0ec]">
                      Cancel
                    </button>
                    <button type="submit" className="rounded-full bg-[#4166fb] px-[22px] py-[13px] text-[15px] font-medium text-white transition hover:bg-[#3558e8]">
                      {PRIVY_ENABLED && (!x?.authenticated || !x.handle)
                        ? 'Log in with X'
                        : modal.mode === 'claim' ? 'Confirm claim' : 'Place bid'}
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
