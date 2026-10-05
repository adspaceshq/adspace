'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Check,
  CheckCircle2,
  Clock3,
  Laptop,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { useToast } from '@/components/ToastProvider'
import {
  approveReviewListing,
  fetchDisputeQueue,
  fetchPayableQueue,
  fetchReviewQueue,
  payApiSpot,
  reconcileChain,
  rejectReviewListing,
  resolveSpotDispute,
} from '@/lib/auth-api'
import { cardPhoto, sellerDisplay, surfaceLabels } from '@/lib/listings'
import type { ApiListing, DisputeItem, PayoutItem, ReviewPolicyRequest } from '@/lib/types'

const defaultPolicy = (listing: ApiListing): ReviewPolicyRequest => ({
  feeBps: 250,
  upliftFeeBps: listing.mode === 'auction' ? 250 : 0,
  maxFeeBps: 250,
  reviewWindowSeconds: 172800,
  deliveryDeadline: new Date(new Date(listing.artworkClose || listing.deadline).getTime() + 7 * 86_400_000).toISOString(),
})

const money = (amount: number, currency = 'USD') =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)

const SOLANA_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'
const ADSPACES_PROGRAM_ID =
  process.env.NEXT_PUBLIC_ADSPACES_PROGRAM_ID ?? '6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW'

const shortAddress = (address: string) =>
  address.length > 12 ? `${address.slice(0, 5)}...${address.slice(-4)}` : address

const explorerAddressUrl = (address: string) => {
  const base = `https://explorer.solana.com/address/${address}`
  return SOLANA_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${encodeURIComponent(SOLANA_CLUSTER)}`
}

const relative = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

interface AdminDashboardViewProps {
  currentTab?: 'admin' | 'creator' | 'sponsor'
  onTabChange?: (tab: 'admin' | 'creator' | 'sponsor') => void
}

export default function AdminDashboardView({ currentTab = 'admin', onTabChange }: AdminDashboardViewProps) {
  const auth = useAuthSession()
  const toast = useToast()
  const [queue, setQueue] = useState<ApiListing[] | null>(null)
  const [error, setError] = useState<string>()
  const [successNote, setSuccessNote] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [payouts, setPayouts] = useState<PayoutItem[] | null>(null)
  const [payBusy, setPayBusy] = useState<string>()
  const [payError, setPayError] = useState<string>()
  const [disputes, setDisputes] = useState<DisputeItem[] | null>(null)
  const [resolutionShares, setResolutionShares] = useState<Record<string, number>>({})
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const [resolutionBusy, setResolutionBusy] = useState<string>()
  const [resolutionError, setResolutionError] = useState<string>()
  const [reconciling, setReconciling] = useState(false)
  const [reconcileNote, setReconcileNote] = useState<string>()
  const [approval, setApproval] = useState<ApiListing | null>(null)
  const [policy, setPolicy] = useState<ReviewPolicyRequest | null>(null)

  const load = useCallback(async () => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    try {
      setQueue(await fetchReviewQueue())
      setError(undefined)
    } catch (e) {
      setQueue(null)
      setError(e instanceof Error ? e.message : 'Could not load review queue.')
    }
    try {
      setPayouts(await fetchPayableQueue())
      setPayError(undefined)
    } catch (e) {
      setPayouts(null)
      setPayError(e instanceof Error ? e.message : 'Could not load payout queue.')
    }
    try {
      setDisputes(await fetchDisputeQueue())
      setResolutionError(undefined)
    } catch (e) {
      setDisputes(null)
      setResolutionError(e instanceof Error ? e.message : 'Could not load disputes.')
    }
  }, [auth.ready, auth.authenticated, auth.userId])

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    let cancelled = false
    fetchReviewQueue().then(
      (q) => { if (!cancelled) { setQueue(q); setError(undefined) } },
      (e) => { if (!cancelled) { setQueue(null); setError(e instanceof Error ? e.message : 'Could not load review queue.') } },
    )
    fetchPayableQueue().then(
      (p) => { if (!cancelled) { setPayouts(p); setPayError(undefined) } },
      (e) => { if (!cancelled) { setPayouts(null); setPayError(e instanceof Error ? e.message : 'Could not load payout queue.') } },
    )
    fetchDisputeQueue().then(
      (items) => { if (!cancelled) { setDisputes(items); setResolutionError(undefined) } },
      (e) => { if (!cancelled) { setDisputes(null); setResolutionError(e instanceof Error ? e.message : 'Could not load disputes.') } },
    )
    return () => { cancelled = true }
  }, [auth.ready, auth.authenticated, auth.userId])

  const act = async (slug: string, action: 'approve' | 'reject', customPolicy?: ReviewPolicyRequest) => {
    let succeeded = false
    setBusy(slug)
    setError(undefined)
    setSuccessNote(undefined)
    try {
      if (action === 'approve') {
        const listing = queue?.find((item) => item.slug === slug)
        if (!listing) throw new Error('Listing is no longer in the review queue.')
        const appliedPolicy = customPolicy ?? policy ?? defaultPolicy(listing)
        await approveReviewListing(slug, appliedPolicy)
        setSuccessNote(`Space "${listing.title}" approved! Seller can now accept commercial terms and publish to devnet.`)
        toast.success('Space approved', 'Commercial terms were sent to the creator.')
      } else {
        const reason = reasons[slug]?.trim() || ''
        await rejectReviewListing(slug, reason)
        setSuccessNote(`Space "${slug}" rejected. Rejection reason returned to creator.`)
        toast.info('Space rejected', 'The creator can revise and resubmit.')
      }
      setReasons((prev) => {
        const next = { ...prev }
        delete next[slug]
        return next
      })
      await load()
      succeeded = true
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Action failed.'
      setError(message)
      toast.error('Review action failed', message)
    } finally {
      setBusy(undefined)
    }
    return succeeded
  }

  const handleSyncDevnet = async () => {
    setReconciling(true)
    setReconcileNote(undefined)
    try {
      const res = await reconcileChain()
      setReconcileNote(`Devnet synced: checked ${res.checked}, updated ${res.updated}, missing ${res.missing}.`)
      toast.success('Devnet synced', `${res.updated} updated, ${res.missing} missing.`)
      await load()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Reconciliation failed.'
      setReconcileNote(message)
      toast.error('Sync failed', message)
    } finally {
      setReconciling(false)
    }
  }

  const cleanHandle = auth.handle ? (auth.handle.startsWith('@') ? auth.handle : `@${auth.handle}`) : null

  return (
    <div className="space-y-8">
      {/* Top Header & Context */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl sm:text-[26px] font-medium tracking-tight text-[#020817]">
              Admin Dashboard
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#020817] px-2.5 py-0.5 text-[11px] font-medium text-white shadow-2xs">
              <ShieldCheck size={12} className="text-emerald-400" />
              <span>Platform Reviewer</span>
            </span>
            {cleanHandle && (
              <span className="hidden items-center gap-1.5 rounded-full bg-[#ecebe6] px-2.5 py-0.5 text-[12px] font-normal text-[#020817] sm:inline-flex">
                {cleanHandle}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] text-[#64748b]">
            Review creator spaces, set on-chain commercial terms, verify proofs, and resolve escrow disputes.
          </p>
        </div>

        {/* Action Controls & View Switcher */}
        <div className="flex flex-wrap items-center gap-3">
          {onTabChange && (
            <div className="inline-flex rounded-full bg-[#ecebe6] p-1 text-[12px] font-medium">
              <button
                type="button"
                onClick={() => onTabChange('admin')}
                className={`rounded-full px-3 py-1 transition cursor-pointer ${
                  currentTab === 'admin'
                    ? 'bg-[#020817] text-white shadow-2xs'
                    : 'text-[#64748b] hover:text-[#020817]'
                }`}
              >
                Admin
              </button>
              <button
                type="button"
                onClick={() => onTabChange('creator')}
                className={`rounded-full px-3 py-1 transition cursor-pointer ${
                  currentTab === 'creator'
                    ? 'bg-[#020817] text-white shadow-2xs'
                    : 'text-[#64748b] hover:text-[#020817]'
                }`}
              >
                Creator
              </button>
              <button
                type="button"
                onClick={() => onTabChange('sponsor')}
                className={`rounded-full px-3 py-1 transition cursor-pointer ${
                  currentTab === 'sponsor'
                    ? 'bg-[#020817] text-white shadow-2xs'
                    : 'text-[#64748b] hover:text-[#020817]'
                }`}
              >
                Sponsor
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={reconciling}
            onClick={() => void handleSyncDevnet()}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#d8d6d0] bg-white px-3.5 py-1.5 text-xs font-normal text-[#020817] transition hover:border-[#020817] disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            <RefreshCw size={13} className={reconciling ? 'animate-spin text-[#4166fb]' : 'text-[#64748b]'} />
            <span>{reconciling ? 'Syncing…' : `Sync ${SOLANA_CLUSTER}`}</span>
          </button>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {reconcileNote && (
        <div className="flex items-center justify-between rounded-xl bg-blue-50/80 px-4 py-2.5 text-xs font-normal text-blue-700">
          <span>{reconcileNote}</span>
          <button onClick={() => setReconcileNote(undefined)} className="text-blue-500 hover:text-blue-800">
            <X size={14} />
          </button>
        </div>
      )}
      {successNote && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-50/80 px-4 py-2.5 text-xs font-normal text-emerald-700">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={15} className="shrink-0 text-emerald-600" />
            <span>{successNote}</span>
          </div>
          <button onClick={() => setSuccessNote(undefined)} className="text-emerald-500 hover:text-emerald-800">
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between rounded-xl bg-red-50/80 px-4 py-2.5 text-xs font-normal text-red-700">
          <span>{error}</span>
          <button onClick={() => setError(undefined)} className="text-red-500 hover:text-red-800">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Unboxed Stats Strip */}
      <section aria-label="Admin overview" className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
            <Clock3 size={14} className="text-[#4166fb]" />
            <span>Pending reviews</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#020817]">
              {queue === null ? '—' : queue.length}
            </span>
            {queue && queue.length > 0 && (
              <span className="inline-flex rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                Action required
              </span>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
            <Wallet size={14} className="text-emerald-500" />
            <span>Payable escrow</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#020817]">
              {payouts === null ? '—' : payouts.length}
            </span>
            <span className="text-xs text-[#64748b]">spots</span>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
            <ShieldAlert size={14} className="text-purple-500" />
            <span>Open disputes</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#020817]">
              {disputes === null ? '—' : disputes.length}
            </span>
            <span className="text-xs text-[#64748b]">active</span>
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
            <Layers size={14} className="text-slate-600" />
            <span>Solana {SOLANA_CLUSTER}</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <a
              href={explorerAddressUrl(ADSPACES_PROGRAM_ID)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono font-medium text-[#020817] hover:text-[#4166fb] hover:underline"
            >
              {shortAddress(ADSPACES_PROGRAM_ID)}
            </a>
            <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </div>
        </div>
      </section>

      {/* Main Review Section: Space Submissions Awaiting Approval */}
      <section className="space-y-4">
        <div className="flex items-center justify-between border-b border-[#ecebe6] pb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-medium tracking-tight text-[#020817]">
                Creator Space Submissions
              </h2>
              {queue && queue.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                  {queue.length} pending
                </span>
              )}
            </div>
            <p className="text-[12px] text-[#64748b]">
              Creators submitted these physical surfaces for review. Inspect photos, set commercial parameters, and approve or reject.
            </p>
          </div>
        </div>

        {queue === null ? (
          <ReviewQueueSkeleton />
        ) : queue.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#d8d6d0] bg-white/60 py-14 text-center">
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#ecebe6] text-[#64748b]">
              <Check size={18} />
            </div>
            <h3 className="text-sm font-medium text-[#020817]">Review queue is clear</h3>
            <p className="mt-1 text-xs text-[#64748b]">
              All registered creator spaces have been reviewed. New submissions will appear here.
            </p>
            <Link
              href="/dashboard"
              className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-[#d8d6d0] bg-white px-4 py-2 text-xs font-semibold text-[#020817] shadow-2xs transition hover:border-[#020817] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
            >
              Open dashboard
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {queue.map((listing) => (
              <ReviewSubmissionCard
                key={listing.id}
                listing={listing}
                busy={busy === listing.slug}
                reason={reasons[listing.slug] ?? ''}
                onReasonChange={(value) => setReasons((prev) => ({ ...prev, [listing.slug]: value }))}
                onApprove={() => {
                  setApproval(listing)
                  setPolicy({
                    platformFeeBps: 250,
                    upliftFeeBps: listing.mode === 'auction' ? 1000 : 0,
                    maxFeeBps: listing.mode === 'auction' ? 1000 : 250,
                    settlementWindowHours: 48,
                    deliveryDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
                  })
                }}
                onReject={() => void act(listing.slug, 'reject')}
              />
            ))}
          </div>
        )}
      </section>

      {/* Commercial Policy Approval Modal */}
      {approval && policy && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="approval-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/40 backdrop-blur-xs p-4 sm:p-6"
          onClick={() => {
            if (busy !== approval.slug) setApproval(null)
          }}
        >
          <div
            className="max-h-[90vh] w-full max-w-[540px] overflow-y-auto rounded-2xl bg-white p-6 sm:p-7 shadow-[0_20px_50px_rgba(2,8,23,0.2)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="approval-title" className="text-xl font-medium tracking-tight text-[#020817]">
                  Approve & Set Commercial Terms
                </h2>
                <p className="mt-1 text-xs text-[#64748b]">
                  Define the Solana smart-contract escrow parameters for this space.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApproval(null)}
                className="rounded-full p-1 text-[#64748b] hover:bg-[#f4f4f4] hover:text-[#020817]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Space Summary */}
            <div className="mt-5 space-y-2 rounded-xl bg-[#f8fafc] p-4 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-[#64748b]">Listing Title</span>
                <span className="font-medium text-[#020817]">{approval.title}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#64748b]">Creator</span>
                <span className="font-medium text-[#020817]">
                  {sellerDisplay({ name: approval.seller, handle: approval.sellerHandle })}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#64748b]">Pricing Mode</span>
                <span className="font-medium text-[#020817] capitalize">{approval.mode}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-[#64748b]">Spots Count</span>
                <span className="font-mono font-medium text-[#020817]">{approval.spots.length} spots</span>
              </div>
            </div>

            {/* Spots Preview */}
            <div className="mt-4 max-h-36 overflow-y-auto divide-y divide-[#ecebe6] rounded-xl border border-[#ecebe6] text-xs">
              {approval.spots.map((spot) => (
                <div key={spot.id} className="flex items-center justify-between px-3.5 py-2">
                  <span className="font-medium text-[#020817]">{spot.label}</span>
                  <span className="font-mono text-[#64748b]">{money(spot.price, approval.currency)}</span>
                </div>
              ))}
            </div>

            {/* Commercial Parameters Form */}
            <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <label className="block text-xs font-medium text-[#020817]">
                Platform Fee (%)
                <input
                  type="text"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={(policy.platformFeeBps ?? policy.feeBps ?? 0) / 100}
                  onChange={(e) =>
                    setPolicy({ ...policy, platformFeeBps: Math.round(Number(e.target.value) * 100) })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none transition focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
                />
                <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Applied to every completed spot.</span>
              </label>

              <label className="block text-xs font-medium text-[#020817]">
                Settlement Window (hours)
                <input
                  type="text"
                  inputMode="numeric"
                  min="1"
                  step="1"
                  value={policy.settlementWindowHours}
                  onChange={(e) =>
                    setPolicy({ ...policy, settlementWindowHours: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none transition focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
                />
                <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Time allowed before settlement actions.</span>
              </label>

              {approval.mode === 'auction' && (
                <>
                  <label className="block text-xs font-medium text-[#020817]">
                    Uplift Fee (%)
                    <input
                      type="text"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={policy.upliftFeeBps / 100}
                      onChange={(e) =>
                        setPolicy({ ...policy, upliftFeeBps: Math.round(Number(e.target.value) * 100) })
                      }
                      className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none transition focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Fee on auction upside above starting price.</span>
                  </label>

                  <label className="block text-xs font-medium text-[#020817]">
                    Maximum Fee (%)
                    <input
                      type="text"
                      inputMode="decimal"
                      min="0"
                      max="100"
                      step="0.01"
                      value={policy.maxFeeBps / 100}
                      onChange={(e) =>
                        setPolicy({ ...policy, maxFeeBps: Math.round(Number(e.target.value) * 100) })
                      }
                      className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none transition focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
                    />
                    <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Caps total platform fees for this auction.</span>
                  </label>
                </>
              )}

              <label className="block text-xs font-medium text-[#020817] sm:col-span-2">
                Proof Delivery Deadline
                <input
                  type="datetime-local"
                  value={policy.deliveryDeadline}
                  onChange={(e) =>
                    setPolicy({ ...policy, deliveryDeadline: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none transition focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
                />
                <span className="mt-1 block text-[11px] font-normal text-[#64748b]">Creator should upload proof before this deadline.</span>
              </label>
            </div>

            <div className="mt-4 rounded-xl border border-[#dbe4ff] bg-[#f6f8ff] px-3 py-2.5 text-[11px] leading-relaxed text-[#526079]">
              Approval only sends these commercial terms to the creator. Nothing is created on-chain until the creator accepts and publishes.
            </div>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={busy === approval.slug}
                onClick={() => setApproval(null)}
                className="rounded-full border border-[#d8d6d0] px-4 py-2 text-xs font-normal text-[#64748b] hover:text-[#020817] disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy === approval.slug}
                onClick={() =>
                  void act(approval.slug, 'approve', policy).then((ok) => {
                    if (ok) setApproval(null)
                  })
                }
                className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb] px-5 py-2 text-xs font-medium text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
              >
                <span>{busy === approval.slug ? 'Approving…' : 'Confirm & approve'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Secondary Context Sections: Disputes & Payouts */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2 pt-4">
        {/* Disputes Queue */}
        <section className="space-y-3">
          <div className="border-b border-[#ecebe6] pb-2.5">
            <h3 className="text-sm font-medium tracking-tight text-[#020817]">
              Escrow Disputes
            </h3>
            <p className="text-[11px] text-[#64748b]">
              Arbitrate disputed delivery by assigning the seller share (remainder returned to buyer).
            </p>
          </div>

          {resolutionError && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{resolutionError}</div>
          )}

          {disputes === null ? (
            <p className="py-6 text-center text-xs text-[#64748b]">Loading disputes…</p>
          ) : disputes.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#64748b]">
              No active disputes in escrow.
            </div>
          ) : (
            <div className="space-y-3">
              {disputes.map((d) => (
                <DisputeCard
                  key={d.spotId}
                  dispute={d}
                  sellerShareBps={resolutionShares[d.spotId] ?? 5000}
                  decision={decisions[d.spotId] ?? ''}
                  busy={resolutionBusy === d.spotId}
                  onSellerShareChange={(value) =>
                    setResolutionShares((prev) => ({ ...prev, [d.spotId]: value }))
                  }
                  onDecisionChange={(value) => setDecisions((prev) => ({ ...prev, [d.spotId]: value }))}
                  onResolve={() =>
                    void (async () => {
                      setResolutionBusy(d.spotId)
                      setResolutionError(undefined)
                      try {
                        await resolveSpotDispute(
                          d.spotId,
                          resolutionShares[d.spotId] ?? 5000,
                          decisions[d.spotId].trim(),
                        )
                        toast.success('Dispute resolved', `${d.listingTitle} ${d.spotLabel} was updated.`)
                        await load()
                      } catch (e) {
                        const message = e instanceof Error ? e.message : 'Resolution failed.'
                        setResolutionError(message)
                        toast.error('Resolution failed', message)
                      } finally {
                        setResolutionBusy(undefined)
                      }
                    })()
                  }
                />
              ))}
            </div>
          )}
        </section>

        {/* Payouts Queue */}
        <section className="space-y-3">
          <div className="border-b border-[#ecebe6] pb-2.5">
            <h3 className="text-sm font-medium tracking-tight text-[#020817]">
              Pending Escrow Payouts
            </h3>
            <p className="text-[11px] text-[#64748b]">
              Spots with completed and verified proof ready for on-chain settlement.
            </p>
          </div>

          {payError && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{payError}</div>
          )}

          {payouts === null ? (
            <p className="py-6 text-center text-xs text-[#64748b]">Loading payouts…</p>
          ) : payouts.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#64748b]">
              No spots awaiting payout release.
            </div>
          ) : (
            <div className="space-y-2.5">
              {payouts.map((p) => (
                <PayoutCard
                  key={p.spotId}
                  payout={p}
                  busy={payBusy === p.spotId}
                  onPay={() =>
                    void (async () => {
                      setPayBusy(p.spotId)
                      setPayError(undefined)
                      try {
                        await payApiSpot(p.spotId, `auto-release-${Date.now()}`)
                        toast.success('Payout recorded', `${p.listingTitle} ${p.spotLabel} is marked paid.`)
                        await load()
                      } catch (e) {
                        const message = e instanceof Error ? e.message : 'Payout failed.'
                        setPayError(message)
                        toast.error('Payout failed', message)
                      } finally {
                        setPayBusy(undefined)
                      }
                    })()
                  }
                />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ReviewQueueSkeleton() {
  return (
    <div className="grid gap-3" aria-label="Loading review queue">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="rounded-2xl border border-[#e7e5e0] bg-white p-3 shadow-[0_10px_30px_rgba(2,8,23,0.04)]">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex gap-3">
              <div className="h-20 w-28 shrink-0 animate-pulse rounded-xl bg-[#ecebe6]" />
              <div className="flex-1 space-y-3 py-1">
                <div className="h-4 w-48 animate-pulse rounded-full bg-[#ecebe6]" />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="h-3 w-32 animate-pulse rounded-full bg-[#f1f0ec]" />
                  <div className="h-3 w-28 animate-pulse rounded-full bg-[#f1f0ec]" />
                  <div className="h-3 w-24 animate-pulse rounded-full bg-[#f1f0ec]" />
                  <div className="h-3 w-36 animate-pulse rounded-full bg-[#f1f0ec]" />
                </div>
                <div className="h-9 animate-pulse rounded-xl bg-[#f8fafc]" />
              </div>
            </div>
            <div className="space-y-2">
              <div className="h-9 animate-pulse rounded-xl bg-[#f1f0ec]" />
              <div className="flex justify-end gap-2">
                <div className="h-8 w-20 animate-pulse rounded-full bg-[#f1f0ec]" />
                <div className="h-8 w-28 animate-pulse rounded-full bg-[#e9edfe]" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function ReviewSubmissionCard({
  listing,
  busy,
  reason,
  onReasonChange,
  onApprove,
  onReject,
}: {
  listing: ApiListing
  busy: boolean
  reason: string
  onReasonChange: (value: string) => void
  onApprove: () => void
  onReject: () => void
}) {
  const surfaceName = (listing.surface && surfaceLabels[listing.surface]) || listing.surface || 'Surface'
  const spotCount = listing.spots.length
  const minPrice = listing.spots.reduce((min, spot) => Math.min(min, spot.price), Infinity)
  const hasPrice = Number.isFinite(minPrice)
  const thumb = listing.image || cardPhoto(listing)
  const seller = sellerDisplay({ name: listing.seller, handle: listing.sellerHandle })

  return (
    <article className="rounded-2xl border border-[#e7e5e0] bg-white p-3 shadow-[0_10px_30px_rgba(2,8,23,0.04)]">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex min-w-0 gap-3">
          <div className="h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-[#ecebe6] shadow-2xs">
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumb} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center text-xs text-[#a1a1aa]">
                <Laptop size={18} />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[#020817]">{listing.title}</h3>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                  listing.mode === 'auction'
                    ? 'bg-[#e9edfe] text-[#3154e8]'
                    : 'bg-emerald-50 text-emerald-700'
                }`}
              >
                {listing.mode === 'auction' ? 'Auction' : 'Fixed price'}
              </span>
            </div>
            <div className="mt-2 grid gap-2 text-[12px] text-[#64748b] sm:grid-cols-2">
              <span>
                Creator <span className="font-medium text-[#020817]">{seller}</span>
              </span>
              <span>
                Surface <span className="font-medium text-[#020817]">{surfaceName}</span>
              </span>
              <span>
                Spots <span className="font-mono text-[#020817]">{spotCount}</span>
              </span>
              <span>
                Pricing{' '}
                <span className="font-mono text-[#020817]">
                  {hasPrice ? `from ${money(minPrice, listing.currency)}` : 'custom'}
                </span>
              </span>
            </div>
            <div className="mt-3 rounded-xl bg-[#f8fafc] px-3 py-2 text-[12px] text-[#64748b]">
              Approval sends commercial terms to the creator. The listing is only created on-chain after the creator accepts.
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
            Rejection feedback
            <input
              type="text"
              value={reason}
              onChange={(event) => onReasonChange(event.target.value)}
              placeholder="Add a reason before rejecting"
              maxLength={500}
              className="mt-1 w-full rounded-xl border border-[#d8d6d0] bg-white px-3 py-2 text-xs normal-case tracking-normal text-[#020817] outline-none transition focus:border-[#4166fb]"
            />
          </label>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className="inline-flex cursor-pointer items-center rounded-full border border-[#d8d6d0] bg-white px-3.5 py-1.5 text-xs font-normal text-[#dc2626] transition hover:border-[#dc2626] hover:bg-red-50/50 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onApprove}
              className="inline-flex cursor-pointer items-center rounded-full bg-[#4166fb] px-4 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50"
            >
              Review terms
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

function DisputeCard({
  dispute,
  sellerShareBps,
  decision,
  busy,
  onSellerShareChange,
  onDecisionChange,
  onResolve,
}: {
  dispute: DisputeItem
  sellerShareBps: number
  decision: string
  busy: boolean
  onSellerShareChange: (value: number) => void
  onDecisionChange: (value: string) => void
  onResolve: () => void
}) {
  const sellerShare = Math.max(0, Math.min(10000, sellerShareBps))
  const sellerPercent = sellerShare / 100
  const buyerPercent = 100 - sellerPercent

  return (
    <article className="rounded-2xl border border-[#e7e5e0] bg-white p-3.5 shadow-[0_10px_30px_rgba(2,8,23,0.04)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="text-[13px] font-semibold text-[#020817]">{dispute.listingTitle}</h4>
          <p className="mt-0.5 text-[12px] text-[#64748b]">
            {dispute.spotLabel} · {money(dispute.amount, dispute.currency)}
          </p>
        </div>
        <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-medium text-red-700">
          Disputed
        </span>
      </div>
      <p className="mt-3 rounded-xl bg-red-50/70 px-3 py-2 text-[12px] leading-relaxed text-red-700">
        {dispute.reason || 'No dispute reason provided.'}
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)_auto] sm:items-end">
        <label className="text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
          Seller share
          <input
            type="number"
            min={0}
            max={10000}
            value={sellerShare}
            onChange={(event) => onSellerShareChange(Number(event.target.value))}
            className="mt-1 w-full rounded-xl border border-[#d8d6d0] px-3 py-2 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
          />
        </label>
        <label className="text-[11px] font-medium uppercase tracking-wider text-[#64748b]">
          Decision note
          <input
            type="text"
            value={decision}
            onChange={(event) => onDecisionChange(event.target.value)}
            placeholder={`Seller ${sellerPercent.toFixed(0)}%, buyer ${buyerPercent.toFixed(0)}%`}
            className="mt-1 w-full rounded-xl border border-[#d8d6d0] px-3 py-2 text-xs normal-case tracking-normal text-[#020817] outline-none focus:border-[#4166fb]"
          />
        </label>
        <button
          type="button"
          disabled={busy || !decision.trim()}
          onClick={onResolve}
          className="inline-flex cursor-pointer justify-center rounded-full bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#3558e8] disabled:opacity-50"
        >
          {busy ? 'Resolving…' : 'Resolve'}
        </button>
      </div>
    </article>
  )
}

function PayoutCard({
  payout,
  busy,
  onPay,
}: {
  payout: PayoutItem
  busy: boolean
  onPay: () => void
}) {
  return (
    <article className="rounded-2xl border border-[#e7e5e0] bg-white p-3.5 shadow-[0_10px_30px_rgba(2,8,23,0.04)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-[13px] font-semibold text-[#020817]">{payout.listingTitle}</h4>
          <p className="mt-0.5 text-[12px] text-[#64748b]">
            {payout.spotLabel} · Seller {payout.seller}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <span className="font-mono text-sm font-semibold text-[#020817]">
            {money(payout.amount, payout.currency)}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onPay}
            className="inline-flex cursor-pointer rounded-full bg-[#020817] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#1a2436] disabled:opacity-50"
          >
            {busy ? 'Paying…' : 'Pay out'}
          </button>
        </div>
      </div>
    </article>
  )
}
