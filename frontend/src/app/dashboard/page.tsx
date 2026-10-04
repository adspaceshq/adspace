'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMfa } from '@privy-io/react-auth'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  Copy,
  ExternalLink,
  LayoutGrid,
  Plus,
  Rows3,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import Header from '@/components/Header'
import SponsorDashboardView from '@/components/SponsorDashboardView'
import AdminDashboardView from '@/components/AdminDashboardView'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { useStore } from '@/components/StoreProvider'
import {
  acceptListingTerms,
  approveApiSpot,
  closeApiListing,
  confirmWalletWithdrawal,
  createWalletWithdrawal,
  deleteApiListing,
  executeWalletWithdrawal,
  failWalletWithdrawal,
  fetchSellerDashboard,
  fetchTerms,
  fetchWalletWithdrawals,
  fulfillApiSpot,
  refundApiSpot,
  rejectApiSpot,
  reopenApiListing,
} from '@/lib/auth-api'
import { cardPhoto, isEnded } from '@/lib/listings'
import type { SellerDashboard, TermsDoc, WalletWithdrawal } from '@/lib/types'
import { embeddedUsdcBalance } from '@/lib/adspaces-program'

const money = (amount: number, currency: string) =>
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

export default function DashboardPage() {
  const auth = useAuthSession()
  const isReviewer = Boolean(
    auth.isReviewer ||
    (auth.handle && ['adspacesfun', 'notcodesid', 'x402__ai'].includes(auth.handle.replace('@', '').toLowerCase()))
  )

  const [activeTab, setActiveTab] = useState<'admin' | 'creator' | 'sponsor' | null>(null)

  // Default active tab: admin if reviewer, otherwise creator (or sponsor if set)
  const currentTab = activeTab ?? (isReviewer ? 'admin' : (auth.accountType === 'sponsor' ? 'sponsor' : 'creator'))

  if (currentTab === 'admin') {
    return (
      <div className="flex min-h-screen lg:h-screen flex-col bg-[#f4f4f4] overflow-y-auto">
        <Header />
        <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-6 pt-4 md:pt-6">
          <AdminDashboardView
            currentTab={currentTab}
            onTabChange={(tab) => setActiveTab(tab)}
          />
        </main>
      </div>
    )
  }

  if (currentTab === 'sponsor') {
    return (
      <div className="flex min-h-screen lg:h-screen flex-col bg-[#f4f4f4] overflow-y-auto">
        <Header />
        <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-6 pt-4 md:pt-6">
          {isReviewer && (
            <div className="mb-4 flex justify-end">
              <div className="inline-flex rounded-full bg-[#ecebe6] p-1 text-[12px] font-medium">
                <button
                  type="button"
                  onClick={() => setActiveTab('admin')}
                  className="rounded-full px-3 py-1 text-[#64748b] hover:text-[#020817] transition cursor-pointer"
                >
                  Admin
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('creator')}
                  className="rounded-full px-3 py-1 text-[#64748b] hover:text-[#020817] transition cursor-pointer"
                >
                  Creator
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('sponsor')}
                  className="rounded-full bg-[#020817] px-3 py-1 text-white shadow-2xs transition cursor-pointer"
                >
                  Sponsor
                </button>
              </div>
            </div>
          )}
          <SponsorDashboardView />
        </main>
      </div>
    )
  }

  return (
    <SellerDashboardPage
      isReviewer={isReviewer}
      currentTab={currentTab}
      onTabChange={(tab) => setActiveTab(tab)}
    />
  )
}

function SponsorDashboardPage() {
  return (
    <div className="flex min-h-screen lg:h-screen flex-col bg-[#f4f4f4] overflow-y-auto">
      <Header />
      <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-6 pt-4 md:pt-6">
        <SponsorDashboardView />
      </main>
    </div>
  )
}

function SellerDashboardPage({
  isReviewer,
  currentTab = 'creator',
  onTabChange,
}: {
  isReviewer?: boolean
  currentTab?: 'admin' | 'creator' | 'sponsor'
  onTabChange?: (tab: 'admin' | 'creator' | 'sponsor') => void
}) {
  const auth = useAuthSession()
  const { refresh } = useStore()
  const [data, setData] = useState<SellerDashboard | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [terms, setTerms] = useState<TermsDoc | null>(null)
  const [termsFor, setTermsFor] = useState<string | null>(null)
  const [termsError, setTermsError] = useState<string>()
  const { clear: clearMfa, promptMfa } = useMfa()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string>()
  const [withdrawSignature, setWithdrawSignature] = useState<string>()
  const [withdrawing, setWithdrawing] = useState(false)
  const [walletUsdc, setWalletUsdc] = useState<number>()
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawal[]>([])
  const [copiedWallet, setCopiedWallet] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{ kind: 'refund'; spotId: string } | { kind: 'delete'; slug: string } | null>(null)
  const confirming = Boolean(confirmAction && busy === (confirmAction.kind === 'refund' ? confirmAction.spotId : confirmAction.slug))
  const termsListing = termsFor ? data?.listings.find((listing) => listing.slug === termsFor) : undefined

  const load = useCallback(async () => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    try {
      setData(await fetchSellerDashboard())
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your dashboard.')
    }
  }, [auth.ready, auth.authenticated, auth.userId])

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    let cancelled = false
    fetchSellerDashboard().then(
      (d) => {
        if (!cancelled) {
          setData(d)
          setError(undefined)
        }
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your dashboard.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [auth.ready, auth.authenticated, auth.userId])

  useEffect(() => {
    if (!auth.walletAddress) return
    let cancelled = false
    void embeddedUsdcBalance(auth.walletAddress).then((balance) => {
      if (!cancelled) setWalletUsdc(balance)
    })
    return () => {
      cancelled = true
    }
  }, [auth.walletAddress])

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    void fetchWalletWithdrawals().then(setWithdrawals).catch(() => setWithdrawals([]))
  }, [auth.ready, auth.authenticated, auth.userId])

  const act = async (spotId: string, action: 'approve' | 'reject' | 'fulfill' | 'refund') => {
    if (action === 'refund') {
      setConfirmAction({ kind: 'refund', spotId })
      return
    }
    setBusy(spotId)
    setError(undefined)
    try {
      if (action === 'approve') await approveApiSpot(spotId)
      else if (action === 'reject') await rejectApiSpot(spotId)
      else if (action === 'fulfill') await fulfillApiSpot(spotId)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(undefined)
    }
  }

  const actListing = async (slug: string, action: 'close' | 'reopen' | 'delete') => {
    if (action === 'delete') {
      setConfirmAction({ kind: 'delete', slug })
      return
    }
    setBusy(slug)
    setError(undefined)
    try {
      if (action === 'close') await closeApiListing(slug)
      else if (action === 'reopen') await reopenApiListing(slug)
      else await deleteApiListing(slug)
      await load()
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(undefined)
    }
  }

  const runConfirmedAction = async () => {
    if (!confirmAction) return
    const busyId = confirmAction.kind === 'refund' ? confirmAction.spotId : confirmAction.slug
    setBusy(busyId)
    setError(undefined)
    try {
      if (confirmAction.kind === 'refund') {
        await refundApiSpot(confirmAction.spotId)
      } else {
        await deleteApiListing(confirmAction.slug)
        await refresh()
      }
      setConfirmAction(null)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(undefined)
    }
  }

  const openTerms = async (slug: string) => {
    setTermsFor(slug)
    setTermsError(undefined)
    if (terms) return
    try {
      setTerms(await fetchTerms())
    } catch (e) {
      setTermsError(e instanceof Error ? e.message : 'Could not load the terms.')
    }
  }

  const accept = async () => {
    if (!termsFor || !terms) return
    setBusy(termsFor)
    setTermsError(undefined)
    try {
      await acceptListingTerms(termsFor, terms.version)
      setTermsFor(null)
      await load()
      await refresh()
    } catch (e) {
      setTermsError(e instanceof Error ? e.message : 'Could not accept the terms.')
    } finally {
      setBusy(undefined)
    }
  }

  const withdraw = async () => {
    if (!auth.walletDelegated) {
      setWithdrawError('Enable gasless transactions from your profile before withdrawing.')
      return
    }
    setWithdrawing(true)
    setWithdrawError(undefined)
    setWithdrawSignature(undefined)
    let intent: WalletWithdrawal | undefined
    let submittedSignature: string | undefined
    try {
      if (!auth.mfaEnabled) {
        auth.setupMfa()
        throw new Error('Set up two-factor authentication before withdrawing')
      }
      await clearMfa()
      await promptMfa()
      intent = await createWalletWithdrawal(withdrawAddress.trim(), Number(withdrawAmount))
      setWithdrawals((current) => [intent!, ...current])
      const confirmed = await executeWalletWithdrawal(intent.id)
      submittedSignature = confirmed.signature
      setWithdrawals((current) =>
        current.map((item) => (item.id === confirmed.id ? confirmed : item)),
      )
      setWithdrawSignature(confirmed.signature)
      setWithdrawAmount('')
      if (auth.walletAddress) setWalletUsdc(await embeddedUsdcBalance(auth.walletAddress))
    } catch (e) {
      if (intent && !submittedSignature) {
        void failWalletWithdrawal(intent.id)
          .then((failed) => {
            setWithdrawals((current) =>
              current.map((item) => (item.id === failed.id ? failed : item)),
            )
          })
          .catch(() => undefined)
      }
      if (submittedSignature) {
        setWithdrawSignature(submittedSignature)
        void fetchWalletWithdrawals().then(setWithdrawals).catch(() => undefined)
        setWithdrawError('Transfer submitted. Confirmation is still pending and can be retried below.')
      } else {
        setWithdrawError(e instanceof Error ? e.message : 'Withdrawal failed.')
      }
    } finally {
      setWithdrawing(false)
    }
  }

  const copyAddress = () => {
    if (!auth.walletAddress) return
    navigator.clipboard.writeText(auth.walletAddress)
    setCopiedWallet(true)
    setTimeout(() => setCopiedWallet(false), 2000)
  }

  const cleanHandle = auth.handle ? (auth.handle.startsWith('@') ? auth.handle : `@${auth.handle}`) : null

  return (
    <div className="flex min-h-screen lg:h-screen flex-col bg-[#f4f4f4] overflow-y-auto">
      <Header />
      <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-6 pt-4 md:pt-6">
          {!auth.ready ? (
            <DashboardSkeleton />
          ) : !auth.authenticated ? (
            <section className="mx-auto max-w-lg py-16 text-center">
              <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full bg-[#020817] font-mono text-lg font-medium text-white shadow-sm">
                X
              </div>
              <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-[#020817]">Creator Dashboard</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-[#64748b]">
                Log in with X to manage your physical spaces, review incoming sponsors, and claim USDC payouts.
              </p>
              <button
                onClick={() => auth.login({ method: 'twitter' })}
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#020817] px-7 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#1a2436] active:scale-[0.98] cursor-pointer"
              >
                <span>Authenticate with X</span>
                <ArrowRight size={15} />
              </button>
            </section>
          ) : (
            <>
              {/* Header */}
              <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h1 className="text-2xl sm:text-[26px] font-medium tracking-tight text-[#020817]">
                      Creator Dashboard
                    </h1>
                    {cleanHandle && (
                      <span className="hidden items-center gap-1.5 rounded-full bg-[#f1f0ec] px-3 py-0.5 text-[13px] font-normal text-[#020817] sm:inline-flex">
                        {auth.avatar && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={auth.avatar}
                            alt=""
                            className="h-4 w-4 rounded-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        )}
                        <span>{cleanHandle}</span>
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[13px] text-[#64748b]">
                    Manage your physical spaces, sponsor bids, and on-chain payouts.
                    {auth.isReviewer && (
                      <>
                        {' '}
                        ·{' '}
                        <Link href="/review" className="font-normal text-[#4166fb] hover:underline">
                          Review queue →
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {isReviewer && (
                    <div className="inline-flex rounded-full bg-[#ecebe6] p-1 text-[12px] font-medium">
                      <button
                        type="button"
                        onClick={() => onTabChange?.('admin')}
                        className="rounded-full px-3 py-1 text-[#64748b] hover:text-[#020817] transition cursor-pointer"
                      >
                        Admin
                      </button>
                      <button
                        type="button"
                        onClick={() => onTabChange?.('creator')}
                        className="rounded-full bg-[#020817] px-3 py-1 text-white shadow-2xs transition cursor-pointer"
                      >
                        Creator
                      </button>
                      <button
                        type="button"
                        onClick={() => onTabChange?.('sponsor')}
                        className="rounded-full px-3 py-1 text-[#64748b] hover:text-[#020817] transition cursor-pointer"
                      >
                        Sponsor
                      </button>
                    </div>
                  )}
                  <Link
                    href="/list"
                    className="group inline-flex w-fit items-center gap-2 rounded-full bg-[#4166fb] px-5 py-2.5 text-[13px] font-medium text-white shadow-[0_10px_25px_-6px_rgba(65,102,251,0.4)] transition hover:bg-[#3558e8] active:scale-[0.98]"
                  >
                    <Plus size={15} className="transition-transform duration-150 group-hover:rotate-90" />
                    <span>List a new space</span>
                  </Link>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="mb-6 flex items-center justify-between rounded-xl bg-red-50/80 px-4 py-2.5 text-sm text-red-700"
                >
                  <span>{error}</span>
                  <button onClick={() => setError(undefined)} className="text-red-500 hover:text-red-800">
                    <X size={16} />
                  </button>
                </div>
              )}

              {!data ? (
                <DashboardSkeleton />
              ) : (
                <>
                  {/* Unboxed Stats Strip */}
                  <section aria-label="Seller summary" className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
                    <MetricItem
                      icon={<LayoutGrid size={15} className="text-[#4166fb]" />}
                      label="Active spaces"
                      value={String(data.summary.activeListings)}
                    />
                    <MetricItem
                      icon={<Rows3 size={15} className="text-amber-500" />}
                      label="Open spots"
                      value={String(data.summary.openSpots)}
                    />
                    <MetricItem
                      icon={<Clock3 size={15} className="text-purple-500" />}
                      label="Pending review"
                      value={String(data.summary.pendingApproval)}
                    />
                    <MetricItem
                      icon={<CircleDollarSign size={15} className="text-emerald-500" />}
                      label="Gross revenue"
                      value={money(data.summary.revenue, data.summary.currency)}
                    />
                    <MetricItem
                      icon={<Wallet size={15} className="text-slate-600" />}
                      label="Paid out"
                      value={money(data.summary.paidOut ?? 0, data.summary.currency)}
                    />
                  </section>

                  {/* Two-Column Grid: Left (Spaces & Queue) + Right (Settlement & Wallet) */}
                  <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
                    {/* Left Column (8 cols): Your Spaces + Attention Queue */}
                    <div className="lg:col-span-8 space-y-6">
                      {/* Listings Section (Unboxed) */}
                      <section>
                        <div className="mb-3 flex items-center justify-between">
                          <div>
                            <h2 className="text-[15px] font-medium tracking-tight text-[#020817]">Your spaces</h2>
                            <p className="text-[12px] text-[#64748b]">Active physical spaces available for sponsor placements.</p>
                          </div>
                          <Link
                            href="/browse"
                            className="inline-flex items-center gap-1 text-[13px] font-normal text-[#4166fb] transition hover:text-[#3154e8]"
                          >
                            <span>Marketplace</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>

                        {data.listings.length === 0 ? (
                          <Empty text="You haven’t listed a space yet." action="List your first space" href="/list" />
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[640px] text-left text-sm">
                              <thead>
                                <tr className="border-b border-[#ecebe6] text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
                                  <th className="pb-2.5 pr-4">Space</th>
                                  <th className="pb-2.5 px-3">Status</th>
                                  <th className="pb-2.5 px-3">Spots</th>
                                  <th className="pb-2.5 px-3">Pricing</th>
                                  <th className="pb-2.5 px-3">Revenue</th>
                                  <th className="pb-2.5 pl-3 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#ecebe6]/60">
                                {data.listings.map((l) => (
                                  <tr key={l.id} className="transition hover:bg-black/[0.015]">
                                    <td className="py-2.5 pr-4">
                                      <div className="flex items-center gap-3">
                                        <div className="h-10 w-14 shrink-0 overflow-hidden rounded-lg bg-[#f1f0ec] shadow-2xs">
                                          {cardPhoto(l) ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={cardPhoto(l)} alt="" className="h-full w-full object-cover" />
                                          ) : (
                                            <div className="grid h-full w-full place-items-center text-xs text-[#a1a1aa]">
                                              Space
                                            </div>
                                          )}
                                        </div>
                                        <div className="min-w-0">
                                          <span className="block truncate font-medium text-[#020817] text-[13px]">
                                            {l.title}
                                          </span>
                                          {l.reviewNote && (
                                            <span className="mt-0.5 block max-w-[240px] text-[11px] font-normal text-[#dc2626]">
                                              Note: {l.reviewNote}
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap">
                                      <ListingStatusBadge status={l.status} deadline={l.deadline} />
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap">
                                      <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f2] px-2.5 py-0.5 font-mono text-[11px] font-normal text-[#020817]">
                                        {l.sold} / {l.open} sold
                                      </span>
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap text-[12px] font-normal text-[#64748b]">
                                      {l.mode === 'fixed' ? 'Fixed' : 'Auction'}
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[13px] font-normal text-[#020817]">
                                      {money(l.revenue, l.currency)}
                                    </td>
                                    <td className="py-2.5 pl-3 whitespace-nowrap text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        {l.status === 'active' && (
                                          <Link
                                            href={`/listings/${l.slug}`}
                                            className="inline-flex rounded-full border border-[#d8d6d0] px-3 py-0.5 text-xs font-normal text-[#020817] transition hover:border-[#4166fb] hover:text-[#4166fb]"
                                          >
                                            View
                                          </Link>
                                        )}
                                        {l.status === 'approved' && (
                                          <button
                                            disabled={busy === l.slug}
                                            onClick={() => void openTerms(l.slug)}
                                            className="rounded-full bg-[#4166fb] px-3 py-0.5 text-xs font-normal text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
                                          >
                                            Accept terms
                                          </button>
                                        )}
                                        {l.status !== 'closed' ? (
                                          <button
                                            disabled={busy === l.slug}
                                            onClick={() => void actListing(l.slug, 'close')}
                                            className="rounded-full border border-[#d8d6d0] px-3 py-0.5 text-xs font-normal text-[#64748b] transition hover:text-[#020817] disabled:opacity-50 cursor-pointer"
                                          >
                                            Close
                                          </button>
                                        ) : (
                                          <button
                                            disabled={busy === l.slug}
                                            onClick={() => void actListing(l.slug, 'reopen')}
                                            className="rounded-full bg-[#4166fb] px-3 py-0.5 text-xs font-normal text-white transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
                                          >
                                            Resubmit
                                          </button>
                                        )}
                                        <button
                                          disabled={busy === l.slug}
                                          onClick={() => void actListing(l.slug, 'delete')}
                                          className="rounded-full p-1 text-[#a1a1aa] transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 cursor-pointer"
                                          title="Delete space"
                                        >
                                          <Trash2 size={14} />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </section>

                      {/* Needs Attention Section (Only shown when action is required) */}
                      {data.attention.length > 0 && (
                        <section className="pt-2">
                          <div className="mb-3">
                            <h2 className="text-[15px] font-medium tracking-tight text-[#020817]">Needs your attention</h2>
                            <p className="text-[12px] text-[#64748b]">
                              Review incoming sponsor bids, approve placements, and submit proof of delivery.
                            </p>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full min-w-[700px] text-left text-sm">
                              <thead>
                                <tr className="border-b border-[#ecebe6] text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
                                  <th className="pb-2.5 pr-4">Buyer</th>
                                  <th className="pb-2.5 px-3">Space & Spot</th>
                                  <th className="pb-2.5 px-3">Amount</th>
                                  <th className="pb-2.5 px-3">Submitted</th>
                                  <th className="pb-2.5 px-3">Status</th>
                                  <th className="pb-2.5 pl-3 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[#ecebe6]/60">
                                {data.attention.map((item) => (
                                  <tr key={item.spotId} className="transition hover:bg-black/[0.015]">
                                    <td className="py-2.5 pr-4 font-mono text-[13px] font-normal text-[#020817]">
                                      {item.buyer}
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <span className="block font-medium text-[#020817] text-[13px]">
                                        {item.listingTitle}
                                      </span>
                                      <span className="block text-[11px] text-[#64748b]">{item.spotLabel}</span>
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-[13px] font-normal text-[#020817]">
                                      {money(item.amount, item.currency)}
                                    </td>
                                    <td className="py-2.5 px-3 text-[12px] text-[#64748b]">
                                      {relative(item.submittedAt)}
                                    </td>
                                    <td className="py-2.5 px-3 whitespace-nowrap">
                                      <AttentionStatusBadge
                                        status={item.status}
                                        artworkReceived={item.artworkReceived}
                                        disputeReason={item.disputeReason}
                                      />
                                    </td>
                                    <td className="py-2.5 pl-3 whitespace-nowrap text-right">
                                      <div className="flex items-center justify-end gap-1.5">
                                        {item.status === 'pending' ? (
                                          <>
                                            <button
                                              disabled={busy === item.spotId}
                                              onClick={() => void act(item.spotId, 'approve')}
                                              className="rounded-full bg-[#4166fb] px-3.5 py-0.5 text-xs font-medium text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
                                            >
                                              Approve
                                            </button>
                                            <button
                                              disabled={busy === item.spotId}
                                              onClick={() => void act(item.spotId, 'reject')}
                                              className="rounded-full border border-[#d8d6d0] px-3.5 py-0.5 text-xs font-normal text-[#64748b] transition hover:text-[#020817] disabled:opacity-50 cursor-pointer"
                                            >
                                              Reject
                                            </button>
                                          </>
                                        ) : item.status === 'delivered' ? (
                                          <Link
                                            href={`/listings/${item.listingSlug}`}
                                            className="inline-flex rounded-full bg-[#4166fb] px-3.5 py-0.5 text-xs font-medium text-white transition hover:bg-[#3558e8]"
                                          >
                                            Upload proof
                                          </Link>
                                        ) : item.status === 'disputed' ? (
                                          <Link
                                            href={`/listings/${item.listingSlug}`}
                                            className="inline-flex rounded-full border border-[#d8d6d0] px-3.5 py-0.5 text-xs font-normal text-[#020817] hover:border-[#4166fb]"
                                          >
                                            View dispute
                                          </Link>
                                        ) : (
                                          <button
                                            disabled={busy === item.spotId}
                                            onClick={() => void act(item.spotId, 'fulfill')}
                                            className="rounded-full border border-[#d8d6d0] px-3.5 py-0.5 text-xs font-normal text-[#020817] transition hover:border-[#4166fb] disabled:opacity-50 cursor-pointer"
                                          >
                                            Mark fulfilled
                                          </button>
                                        )}
                                        {item.status !== 'pending' && (
                                          <button
                                            disabled={busy === item.spotId}
                                            onClick={() => void act(item.spotId, 'refund')}
                                            className="rounded-full border border-red-200 px-3 py-0.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50 cursor-pointer"
                                          >
                                            Refund
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </section>
                      )}
                    </div>

                    {/* Right Column (4 cols): Solana Settlements & Wallet Widget */}
                    <div className="lg:col-span-4 space-y-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h2 id="withdrawals-title" className="text-[15px] font-medium tracking-tight text-[#020817]">
                              Solana Settlements
                            </h2>
                            <span className="font-mono text-[11px] font-normal text-emerald-600">
                              • Devnet
                            </span>
                          </div>
                          <p className="mt-0.5 text-[12px] text-[#64748b]">
                            Sponsor funds settle directly to your wallet.
                          </p>
                        </div>
                      </div>

                      {auth.walletAddress && (
                        <div className="flex items-center justify-between text-[11px] text-[#64748b]">
                          <span className="font-mono">{auth.walletAddress.slice(0, 8)}...{auth.walletAddress.slice(-6)}</span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={copyAddress}
                              className="inline-flex items-center gap-1 hover:text-[#020817] transition cursor-pointer"
                              title="Copy Solana address"
                            >
                              {copiedWallet ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                              <span>{copiedWallet ? 'Copied' : 'Copy'}</span>
                            </button>
                            <span>·</span>
                            <a
                              href={`https://explorer.solana.com/address/${auth.walletAddress}?cluster=devnet`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-0.5 text-[#4166fb] hover:underline"
                            >
                              <span>Explorer</span>
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        </div>
                      )}

                      <div className="divide-y divide-[#ecebe6]/60 border-t border-b border-[#ecebe6]">
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[12px] text-[#64748b]">Available Balance</span>
                          <span className="font-mono text-[15px] font-normal text-[#020817]">
                            {walletUsdc === undefined ? '—' : `$${walletUsdc.toFixed(2)}`}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[12px] text-[#64748b]">In Escrow</span>
                          <span className="font-mono text-[14px] font-normal text-[#64748b]">
                            {money(
                              Math.max(0, data.summary.revenue - (data.summary.paidOut ?? 0)),
                              data.summary.currency,
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between py-2.5">
                          <span className="text-[12px] text-[#64748b]">Total Withdrawn</span>
                          <span className="font-mono text-[14px] font-normal text-[#64748b]">
                            {money(data.summary.paidOut ?? 0, data.summary.currency)}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!auth.mfaEnabled) {
                            void auth.setupMfa()
                            return
                          }
                          setWithdrawOpen(true)
                          setWithdrawError(undefined)
                          setWithdrawSignature(undefined)
                        }}
                        className="w-full rounded-full bg-[#020817] py-2 text-[13px] font-medium text-white transition hover:bg-[#1a2333] active:scale-[0.98] cursor-pointer"
                      >
                        Withdraw USDC
                      </button>

                      {withdrawals.length > 0 && (
                        <div className="pt-2">
                          <p className="mb-2 text-[11px] font-normal uppercase tracking-wider text-[#64748b]">
                            Recent payouts
                          </p>
                          <div className="space-y-1.5">
                            {withdrawals.slice(0, 3).map((w) => (
                              <div key={w.id} className="flex items-center justify-between text-[11px]">
                                <span className="font-mono text-[#64748b]">
                                  {w.destination.slice(0, 6)}...{w.destination.slice(-4)}
                                </span>
                                <span className="font-mono text-[#020817]">
                                  ${w.amount.toFixed(2)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Terms Modal */}
                  {termsFor && (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="terms-title"
                      className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/60 p-4 backdrop-blur-md sm:p-6"
                      onClick={() => {
                        if (busy !== termsFor) setTermsFor(null)
                      }}
                    >
                      <div
                        className="max-h-[90vh] w-full max-w-[500px] overflow-y-auto rounded-[28px] bg-white p-7 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h2 id="terms-title" className="text-2xl font-bold tracking-tight text-[#020817]">
                              Seller terms{terms && ` (${terms.version})`}
                            </h2>
                            <p className="mt-1 text-[13px] text-[#64748b]">
                              Your space was approved. Accept the agreement terms to publish it live.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setTermsFor(null)}
                            disabled={busy === termsFor}
                            className="grid h-8 w-8 place-items-center rounded-full text-[#64748b] hover:bg-[#f1f0ec] hover:text-[#020817]"
                          >
                            <X size={18} />
                          </button>
                        </div>

                        {termsListing && (
                          <div className="mt-5 space-y-2 text-[13px]">
                            <div className="flex justify-between">
                              <span className="text-[#64748b]">Pricing model</span>
                              <span className="font-semibold text-[#020817]">
                                {termsListing.mode === 'fixed' ? 'Fixed price' : 'Auction'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-[#64748b]">Platform fee</span>
                              <span className="font-semibold text-[#020817]">
                                {(((termsListing.platformFeeBps ?? termsListing.feeBps) ?? 0) / 100).toFixed(2)}%
                              </span>
                            </div>
                            {termsListing.mode === 'auction' && (
                              <div className="flex justify-between">
                                <span className="text-[#64748b]">Uplift / max fee</span>
                                <span className="font-semibold text-[#020817]">
                                  {((termsListing.upliftFeeBps ?? 0) / 100).toFixed(2)}% /{' '}
                                  {((termsListing.maxFeeBps ?? 0) / 100).toFixed(2)}%
                                </span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-[#64748b]">Settlement window</span>
                              <span className="font-semibold text-[#020817]">
                                {termsListing.settlementWindowHours ??
                                  (termsListing.reviewWindowSeconds != null
                                    ? Math.round(termsListing.reviewWindowSeconds / 3600)
                                    : 0)}{' '}
                                hours
                              </span>
                            </div>
                          </div>
                        )}

                        <pre className="mt-4 max-h-56 overflow-y-auto whitespace-pre-wrap rounded-2xl bg-[#fafaf9] p-4 font-sans text-[12px] leading-relaxed text-[#020817]/80">
                          {terms ? terms.text : 'Loading terms…'}
                        </pre>

                        {termsError && (
                          <p role="alert" className="mt-3 text-sm text-[#dc2626]">
                            {termsError}
                          </p>
                        )}

                        <div className="mt-6 flex items-center justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setTermsFor(null)}
                            disabled={busy === termsFor}
                            className="rounded-full px-5 py-2.5 text-[14px] font-medium text-[#64748b] transition hover:bg-[#f1f0ec] hover:text-[#020817] disabled:opacity-60 cursor-pointer"
                          >
                            Not yet
                          </button>
                          <button
                            type="button"
                            onClick={() => void accept()}
                            disabled={!terms || busy === termsFor}
                            className="inline-flex items-center rounded-full bg-[#4166fb] px-7 py-3 text-[14px] font-semibold text-white shadow-[0_10px_25px_-6px_rgba(65,102,251,0.5)] transition hover:bg-[#3558e8] active:scale-[0.98] disabled:opacity-60 cursor-pointer"
                          >
                            {busy === termsFor ? 'Accepting…' : 'Accept & go live'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Withdraw Modal */}
                  {withdrawOpen && (
                    <div
                      role="dialog"
                      aria-modal="true"
                      aria-labelledby="withdraw-title"
                      className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/60 p-4 backdrop-blur-md sm:p-6"
                      onClick={() => {
                        if (!withdrawing) setWithdrawOpen(false)
                      }}
                    >
                      <div
                        className="w-full max-w-[480px] rounded-[28px] bg-white p-7 shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <h2 id="withdraw-title" className="text-2xl font-bold tracking-tight text-[#020817]">
                              Withdraw USDC
                            </h2>
                            <p className="mt-1 text-[13px] text-[#64748b]">
                              Transfer devnet USDC from your Privy embedded wallet.
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setWithdrawOpen(false)}
                            disabled={withdrawing}
                            className="grid h-8 w-8 place-items-center rounded-full text-[#64748b] hover:bg-[#f1f0ec] hover:text-[#020817]"
                          >
                            <X size={18} />
                          </button>
                        </div>

                        <div className="mt-5 flex items-center justify-between py-2">
                          <div>
                            <p className="text-[13px] font-semibold text-[#020817]">Two-factor authentication</p>
                            <p className="text-[11px] text-[#64748b]">Required for every withdrawal</p>
                          </div>
                          {auth.mfaEnabled ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                              <ShieldCheck size={14} /> Enabled
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void auth.setupMfa()}
                              className="rounded-full bg-[#020817] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#1a2333]"
                            >
                              Set up
                            </button>
                          )}
                        </div>

                        <label className="mt-4 block text-[13px] font-semibold text-[#020817]">
                          Destination Solana address
                          <input
                            value={withdrawAddress}
                            onChange={(event) => setWithdrawAddress(event.target.value)}
                            spellCheck={false}
                            placeholder="Solana public key address…"
                            className="mt-1.5 block w-full rounded-xl border border-[#e8e7e1] bg-[#fafaf9] px-4 py-3 font-mono text-[13px] outline-none transition focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe]"
                          />
                        </label>

                        <label className="mt-4 block text-[13px] font-semibold text-[#020817]">
                          Amount{' '}
                          <span className="font-normal text-[#64748b]">
                            {walletUsdc !== undefined && `(available $${walletUsdc.toFixed(2)})`}
                          </span>
                          <input
                            value={withdrawAmount}
                            onChange={(event) => setWithdrawAmount(event.target.value)}
                            inputMode="decimal"
                            placeholder="0.00"
                            className="mt-1.5 block w-full rounded-xl border border-[#e8e7e1] bg-[#fafaf9] px-4 py-3 font-mono text-[14px] outline-none transition focus:border-[#4166fb] focus:bg-white focus:shadow-[0_0_0_3px_#e9edfe]"
                          />
                        </label>

                        {withdrawError && (
                          <p role="alert" className="mt-3 text-sm text-[#dc2626]">
                            {withdrawError}
                          </p>
                        )}

                        {withdrawSignature && (
                          <a
                            href={`https://explorer.solana.com/tx/${withdrawSignature}?cluster=${encodeURIComponent(
                              process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet',
                            )}`}
                            target="_blank"
                            rel="noopener"
                            className="mt-3 block break-all text-xs font-medium text-[#4166fb] hover:underline"
                          >
                            Confirmed tx: {withdrawSignature}
                          </a>
                        )}

                        {withdrawals.length > 0 && (
                          <div className="mt-5 border-t border-[#ecebe6] pt-4">
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#64748b]">
                              Recent withdrawals
                            </p>
                            <div className="max-h-32 space-y-1.5 overflow-y-auto">
                              {withdrawals.slice(0, 5).map((item) => (
                                <div
                                  key={item.id}
                                  className="flex items-center justify-between gap-3 text-xs py-1"
                                >
                                  <span className="truncate font-mono text-[#64748b]">
                                    {item.destination.slice(0, 8)}...{item.destination.slice(-6)}
                                  </span>
                                  <span className="font-mono font-semibold text-[#020817]">
                                    ${item.amount.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        <div className="mt-6 flex justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => setWithdrawOpen(false)}
                            disabled={withdrawing}
                            className="rounded-full px-5 py-2.5 text-[14px] font-medium text-[#64748b] transition hover:bg-[#f1f0ec] hover:text-[#020817] disabled:opacity-50 cursor-pointer"
                          >
                            Close
                          </button>
                          <button
                            type="button"
                            onClick={() => void withdraw()}
                            disabled={withdrawing || !withdrawAddress.trim() || !withdrawAmount.trim()}
                            className="inline-flex items-center gap-2 rounded-full bg-[#4166fb] px-6 py-2.5 text-[14px] font-semibold text-white shadow-[0_10px_25px_-6px_rgba(65,102,251,0.5)] transition hover:bg-[#3558e8] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
                          >
                            {withdrawing ? 'Withdrawing…' : 'Confirm withdrawal'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
        <ConfirmDialog
          open={Boolean(confirmAction)}
          title={confirmAction?.kind === 'refund' ? 'Refund this buyer?' : 'Delete this listing?'}
          description={
            confirmAction?.kind === 'refund'
              ? 'This sends an on-chain refund from escrow. The buyer will lose the spot and the action cannot be undone.'
              : 'This permanently removes the listing and its spots from your dashboard. This action cannot be undone.'
          }
          confirmLabel={confirmAction?.kind === 'refund' ? 'Refund buyer' : 'Delete listing'}
          tone="danger"
          busy={confirming}
          onConfirm={() => void runConfirmedAction()}
          onClose={() => {
            if (!confirming) setConfirmAction(null)
          }}
        />
    </div>
  )
}

function MetricItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[12px] font-normal text-[#64748b]">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="mt-1 font-mono text-2xl sm:text-[28px] font-normal tracking-tight text-[#020817]">
        {value}
      </div>
    </div>
  )
}

function ListingStatusBadge({ status, deadline }: { status: string; deadline: string }) {
  const ended = isEnded(deadline)
  if (status === 'active') {
    return (
      <span className={`inline-flex items-center gap-1.5 font-medium text-xs ${
        ended ? 'text-[#64748b]' : 'text-emerald-700'
      }`}>
        <span className={`h-1.5 w-1.5 rounded-full ${ended ? 'bg-slate-400' : 'bg-emerald-500'}`} />
        {ended ? 'Ended' : 'Active'}
      </span>
    )
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-xs text-[#4166fb]">
        <span className="h-1.5 w-1.5 rounded-full bg-[#4166fb]" />
        Approved
      </span>
    )
  }
  if (status === 'submitted') {
    return (
      <span className="inline-flex items-center gap-1.5 font-medium text-xs text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Under review
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 font-medium text-xs text-[#64748b]">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
      Closed
    </span>
  )
}

function AttentionStatusBadge({
  status,
  artworkReceived,
  disputeReason,
}: {
  status: string
  artworkReceived?: boolean
  disputeReason?: string
}) {
  return (
    <div>
      <span
        className={`inline-flex items-center gap-1.5 font-medium text-xs ${
          status === 'pending'
            ? 'text-amber-700'
            : status === 'disputed'
            ? 'text-red-700'
            : status === 'delivered'
            ? 'text-blue-700'
            : 'text-emerald-700'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            status === 'pending'
              ? 'bg-amber-500'
              : status === 'disputed'
              ? 'bg-red-500'
              : status === 'delivered'
              ? 'bg-blue-500'
              : 'bg-emerald-500'
          }`}
        />
        {status === 'pending'
          ? 'Pending'
          : status === 'disputed'
          ? 'Disputed'
          : status === 'delivered'
          ? 'Delivered'
          : 'Approved'}
      </span>
      {status === 'approved' && artworkReceived && (
        <span className="mt-0.5 block text-[11px] font-medium text-emerald-600">Artwork in ✓</span>
      )}
      {status === 'disputed' && disputeReason && (
        <span className="mt-0.5 block max-w-[220px] text-[11px] text-red-600 truncate" title={disputeReason}>
          {disputeReason}
        </span>
      )}
    </div>
  )
}

function Empty({ text, action, href }: { text: string; action?: string; href?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f1f0ec] text-[#64748b] mb-2.5">
        <Sparkles size={18} />
      </div>
      <p className="text-[14px] text-[#64748b]">{text}</p>
      {action && href && (
        <Link
          href={href}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#020817] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#1a2333] transition"
        >
          <Plus size={14} />
          <span>{action}</span>
        </Link>
      )}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="animate-pulse space-y-8 py-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-60 rounded-xl bg-[#eeede8]" />
          <div className="h-4 w-96 rounded-lg bg-[#f4f3ef]" />
        </div>
        <div className="h-11 w-36 rounded-full bg-[#eeede8]" />
      </div>
      <div className="grid grid-cols-2 gap-8 lg:grid-cols-5">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-16 rounded-xl bg-[#f4f3ef]" />
        ))}
      </div>
      <div className="h-24 rounded-2xl bg-[#f4f3ef]" />
      <div className="h-60 rounded-2xl bg-[#f4f3ef]" />
    </div>
  )
}
