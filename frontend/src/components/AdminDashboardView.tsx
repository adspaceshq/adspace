'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Laptop,
  Layers,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
  Wallet,
  X,
  XCircle,
} from 'lucide-react'
import { useAuthSession } from '@/components/AuthSessionProvider'
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
      } else {
        const reason = reasons[slug]?.trim() || ''
        await rejectReviewListing(slug, reason)
        setSuccessNote(`Space "${slug}" rejected. Rejection reason returned to creator.`)
      }
      setReasons((prev) => {
        const next = { ...prev }
        delete next[slug]
        return next
      })
      await load()
      succeeded = true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
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
      await load()
    } catch (e) {
      setReconcileNote(e instanceof Error ? e.message : 'Reconciliation failed.')
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
            <span>{reconciling ? 'Syncing…' : 'Sync devnet'}</span>
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
            <span>Solana Devnet</span>
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-sm font-mono font-medium text-[#020817]">
              6ft49…LMSW
            </span>
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
          <p className="py-12 text-center text-sm text-[#64748b]">Loading review queue…</p>
        ) : queue.length === 0 ? (
          <div className="py-14 text-center">
            <div className="mx-auto mb-3 grid h-10 w-10 place-items-center rounded-full bg-[#ecebe6] text-[#64748b]">
              <Check size={18} />
            </div>
            <h3 className="text-sm font-medium text-[#020817]">Review queue is clear</h3>
            <p className="mt-1 text-xs text-[#64748b]">
              All registered creator spaces have been reviewed. New submissions will appear here.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#ecebe6] text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
                  <th className="pb-2.5 pr-4">Space & Surface</th>
                  <th className="pb-2.5 px-3">Creator</th>
                  <th className="pb-2.5 px-3">Mode</th>
                  <th className="pb-2.5 px-3">Spots & Pricing</th>
                  <th className="pb-2.5 px-3">Rejection reason (optional)</th>
                  <th className="pb-2.5 pl-3 text-right">Review action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#ecebe6]/60">
                {queue.map((l) => {
                  const surfaceName = (l.surface && surfaceLabels[l.surface]) || l.surface || 'MacBook Lid'
                  const spotCount = l.spots.length
                  const minPrice = l.spots.reduce((min, s) => Math.min(min, s.price), Infinity)
                  const hasPrice = Number.isFinite(minPrice)
                  const thumb = l.image || cardPhoto(l)

                  return (
                    <tr key={l.id} className="transition hover:bg-black/[0.015]">
                      {/* Space & Surface */}
                      <td className="py-3.5 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="h-11 w-16 shrink-0 overflow-hidden rounded-lg bg-[#ecebe6] shadow-2xs">
                            {thumb ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={thumb} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="grid h-full w-full place-items-center text-xs text-[#a1a1aa]">
                                <Laptop size={16} />
                              </div>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="block truncate font-medium text-[#020817] text-[13px]">
                              {l.title}
                            </span>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[#64748b]">
                              <span className="inline-flex items-center gap-1 rounded bg-[#ecebe6] px-1.5 py-0.5 text-[10px] font-medium text-[#020817]">
                                {surfaceName}
                              </span>
                              <span>•</span>
                              <span>{relative(l.deadline)}</span>
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Creator */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="text-[12px] font-medium text-[#020817]">
                          {sellerDisplay({ name: l.seller, handle: l.sellerHandle })}
                        </div>
                        {l.sellerHandle && (
                          <div className="text-[11px] text-[#64748b]">
                            @{l.sellerHandle.replace(/^@+/, '')}
                          </div>
                        )}
                      </td>

                      {/* Mode */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-normal ${
                            l.mode === 'auction'
                              ? 'bg-[#e9edfe] text-[#3154e8]'
                              : 'bg-emerald-50 text-emerald-700'
                          }`}
                        >
                          {l.mode === 'auction' ? 'Auction' : 'Fixed price'}
                        </span>
                      </td>

                      {/* Spots & Pricing */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <div className="font-mono text-[12px] font-normal text-[#020817]">
                          {spotCount} {spotCount === 1 ? 'spot' : 'spots'}
                        </div>
                        <div className="text-[11px] text-[#64748b]">
                          {hasPrice ? `From ${money(minPrice, l.currency)}` : 'Custom'}
                        </div>
                      </td>

                      {/* Rejection Note */}
                      <td className="py-3.5 px-3">
                        <input
                          type="text"
                          value={reasons[l.slug] ?? ''}
                          onChange={(e) => setReasons((prev) => ({ ...prev, [l.slug]: e.target.value }))}
                          placeholder="Feedback if rejecting..."
                          maxLength={500}
                          className="w-full min-w-[170px] rounded-lg border border-[#d8d6d0] bg-white px-2.5 py-1.5 text-xs text-[#020817] outline-none transition focus:border-[#4166fb]"
                        />
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 pl-3 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            disabled={busy === l.slug}
                            onClick={() => {
                              setApproval(l)
                              setPolicy({
                                platformFeeBps: 250,
                                upliftFeeBps: l.mode === 'auction' ? 1000 : 0,
                                maxFeeBps: l.mode === 'auction' ? 1000 : 250,
                                settlementWindowHours: 48,
                                deliveryDeadline: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
                              })
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-[#4166fb] px-3.5 py-1 text-xs font-medium text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
                          >
                            <span>Approve</span>
                          </button>

                          <button
                            type="button"
                            disabled={busy === l.slug}
                            onClick={() => void act(l.slug, 'reject')}
                            className="inline-flex items-center gap-1 rounded-full border border-[#d8d6d0] bg-white px-3 py-1 text-xs font-normal text-[#dc2626] transition hover:border-[#dc2626] hover:bg-red-50/50 disabled:opacity-50 cursor-pointer"
                          >
                            <span>Reject</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
            <div className="mt-5 grid grid-cols-2 gap-3.5">
              <label className="block text-xs font-medium text-[#020817]">
                Platform Fee (%)
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={(policy.platformFeeBps ?? policy.feeBps ?? 0) / 100}
                  onChange={(e) =>
                    setPolicy({ ...policy, platformFeeBps: Math.round(Number(e.target.value) * 100) })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-1.5 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
                />
              </label>

              <label className="block text-xs font-medium text-[#020817]">
                Settlement Window (hours)
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={policy.settlementWindowHours}
                  onChange={(e) =>
                    setPolicy({ ...policy, settlementWindowHours: Number(e.target.value) })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-1.5 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
                />
              </label>

              {approval.mode === 'auction' && (
                <>
                  <label className="block text-xs font-medium text-[#020817]">
                    Uplift Fee (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={policy.upliftFeeBps / 100}
                      onChange={(e) =>
                        setPolicy({ ...policy, upliftFeeBps: Math.round(Number(e.target.value) * 100) })
                      }
                      className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-1.5 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
                    />
                  </label>

                  <label className="block text-xs font-medium text-[#020817]">
                    Maximum Fee (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={policy.maxFeeBps / 100}
                      onChange={(e) =>
                        setPolicy({ ...policy, maxFeeBps: Math.round(Number(e.target.value) * 100) })
                      }
                      className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-1.5 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
                    />
                  </label>
                </>
              )}

              <label className="col-span-2 block text-xs font-medium text-[#020817]">
                Proof Delivery Deadline
                <input
                  type="datetime-local"
                  value={policy.deliveryDeadline}
                  onChange={(e) =>
                    setPolicy({ ...policy, deliveryDeadline: e.target.value })
                  }
                  className="mt-1 w-full rounded-lg border border-[#d8d6d0] px-3 py-1.5 text-xs text-[#020817] outline-none focus:border-[#4166fb]"
                />
              </label>
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-[#64748b]">
              Approval sends these commercial terms to the creator. Once the creator accepts the terms, the listing is published to the Solana marketplace.
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                disabled={busy === approval.slug}
                onClick={() => setApproval(null)}
                className="rounded-full border border-[#d8d6d0] px-4 py-1.5 text-xs font-normal text-[#64748b] hover:text-[#020817] disabled:opacity-50 cursor-pointer"
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
                className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb] px-5 py-1.5 text-xs font-medium text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
              >
                <span>{busy === approval.slug ? 'Approving…' : 'Confirm & Approve'}</span>
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
                <div key={d.spotId} className="rounded-xl border border-[#ecebe6] bg-white p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#020817]">
                      {d.listingTitle} • {d.spotLabel}
                    </span>
                    <span className="font-mono text-[#64748b]">{money(d.amount, d.currency)}</span>
                  </div>
                  <p className="text-[11px] text-[#dc2626]">
                    Reason: {d.reason || 'No reason provided'}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={resolutionShares[d.spotId] ?? 5000}
                      onChange={(e) =>
                        setResolutionShares((prev) => ({ ...prev, [d.spotId]: Number(e.target.value) }))
                      }
                      placeholder="Seller share bps"
                      className="w-24 rounded-lg border border-[#d8d6d0] px-2 py-1 text-xs"
                    />
                    <input
                      type="text"
                      value={decisions[d.spotId] ?? ''}
                      onChange={(e) =>
                        setDecisions((prev) => ({ ...prev, [d.spotId]: e.target.value }))
                      }
                      placeholder="Resolution rationale..."
                      className="flex-1 rounded-lg border border-[#d8d6d0] px-2.5 py-1 text-xs"
                    />
                    <button
                      type="button"
                      disabled={resolutionBusy === d.spotId || !(decisions[d.spotId] ?? '').trim()}
                      onClick={() =>
                        void (async () => {
                          setResolutionBusy(d.spotId)
                          setResolutionError(undefined)
                          try {
                            await resolveSpotDispute(
                              d.spotId,
                              resolutionShares[d.spotId] ?? 5000,
                              decisions[d.spotId].trim(),
                            )
                            await load()
                          } catch (e) {
                            setResolutionError(e instanceof Error ? e.message : 'Resolution failed.')
                          } finally {
                            setResolutionBusy(undefined)
                          }
                        })()
                      }
                      className="rounded-full bg-[#4166fb] px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
                    >
                      Resolve
                    </button>
                  </div>
                </div>
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
                <div key={p.spotId} className="flex items-center justify-between rounded-xl border border-[#ecebe6] bg-white p-3 text-xs">
                  <div>
                    <span className="font-medium text-[#020817]">
                      {p.listingTitle} · {p.spotLabel}
                    </span>
                    <div className="text-[11px] text-[#64748b]">
                      Seller: {p.seller}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-medium text-[#020817]">
                      {money(p.amount, p.currency)}
                    </span>
                    <button
                      type="button"
                      disabled={payBusy === p.spotId}
                      onClick={() =>
                        void (async () => {
                          setPayBusy(p.spotId)
                          setPayError(undefined)
                          try {
                            await payApiSpot(p.spotId, `auto-release-${Date.now()}`)
                            await load()
                          } catch (e) {
                            setPayError(e instanceof Error ? e.message : 'Payout failed.')
                          } finally {
                            setPayBusy(undefined)
                          }
                        })()
                      }
                      className="rounded-full bg-[#020817] px-3 py-1 text-xs font-normal text-white disabled:opacity-50"
                    >
                      Pay out
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
