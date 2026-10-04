'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  ExternalLink,
  Handshake,
  Palette,
  Sparkles,
  Truck,
  UploadCloud,
  X,
} from 'lucide-react'
import { useAuthSession } from '@/components/AuthSessionProvider'
import {
  confirmSpotReceipt,
  disputeSpotDelivery,
  fetchSponsorDashboard,
  submitSpotArtwork,
  withdrawSpotDispute,
} from '@/lib/auth-api'
import { uploadToCloudinary } from '@/lib/cloudinary'
import type { SponsorDashboard, SponsorSpot, SponsorSpotStatus } from '@/lib/types'

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)

const STATUS_LABEL: Record<SponsorSpotStatus, string> = {
  pending: 'Awaiting approval',
  sold: 'In production',
  delivered: 'Delivered — verify',
  disputed: 'Reported',
  paid: 'Complete & paid',
  refunded: 'Outbid — refunded',
}

const STATUS_TONE: Record<SponsorSpotStatus, string> = {
  pending: 'text-amber-700',
  sold: 'text-[#4166fb]',
  delivered: 'text-emerald-700',
  disputed: 'text-red-700',
  paid: 'text-[#020817]',
  refunded: 'text-[#64748b]',
}

const MAX_ARTWORK_BYTES = 8 * 1024 * 1024

export default function SponsorDashboardView() {
  const auth = useAuthSession()
  const [data, setData] = useState<SponsorDashboard | null>(null)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [disputing, setDisputing] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')

  const load = useCallback(async () => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    try {
      setData(await fetchSponsorDashboard())
      setError(undefined)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your sponsorships.')
    }
  }, [auth.ready, auth.authenticated, auth.userId])

  useEffect(() => {
    if (!auth.ready || !auth.authenticated || !auth.userId) return
    let cancelled = false
    fetchSponsorDashboard().then(
      (loaded) => {
        if (!cancelled) {
          setData(loaded)
          setError(undefined)
        }
      },
      (e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your sponsorships.')
      },
    )
    return () => {
      cancelled = true
    }
  }, [auth.ready, auth.authenticated, auth.userId])

  const uploadArtwork = (spotId: string, file: File | undefined) => {
    if (!file || busy) return
    if (!file.type.startsWith('image/')) return setToast('Artwork must be an image file.')
    if (file.size > MAX_ARTWORK_BYTES) return setToast('Artwork must be under 8 MB.')
    setBusy(spotId)
    setToast(undefined)
    uploadToCloudinary(file, 'logos', file.name)
      .then((url) => submitSpotArtwork(spotId, { logoUrl: url }))
      .then(async () => {
        await load()
        setBusy(undefined)
        setToast('Artwork submitted successfully.')
      })
      .catch((e) => {
        setBusy(undefined)
        setToast(e instanceof Error ? e.message : 'Could not submit artwork.')
      })
  }

  const review = async (spotId: string, action: 'confirm' | 'withdraw' | { dispute: string }) => {
    setBusy(spotId)
    setToast(undefined)
    try {
      if (action === 'confirm') await confirmSpotReceipt(spotId)
      else if (action === 'withdraw') await withdrawSpotDispute(spotId)
      else await disputeSpotDelivery(spotId, action.dispute)
      setDisputing(null)
      setDisputeReason('')
      await load()
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Could not update that spot.')
    } finally {
      setBusy(undefined)
    }
  }

  if (!auth.ready) return <Skeleton />
  if (!auth.authenticated) {
    return (
      <section className="mx-auto max-w-lg py-20 text-center">
        <div className="mx-auto mb-5 grid h-12 w-12 place-items-center rounded-full bg-[#020817] font-mono text-lg font-medium text-white shadow-sm">
          𝕏
        </div>
        <h1 className="text-2xl sm:text-3xl font-medium tracking-tight text-[#020817]">Sponsor Dashboard</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-[#64748b]">
          Log in with X to track your claimed spots, upload artwork logos, and verify physical campaign delivery.
        </p>
        <button
          onClick={() => auth.login({ method: 'twitter' })}
          className="mt-7 inline-flex items-center gap-2 rounded-full bg-[#020817] px-7 py-3 text-[14px] font-medium text-white shadow-sm transition hover:bg-[#1a2436] active:scale-[0.98] cursor-pointer"
        >
          <span>Authenticate with X</span>
        </button>
      </section>
    )
  }

  if (error) {
    return (
      <div role="alert" className="mb-6 rounded-xl bg-red-50/80 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    )
  }

  if (!data) return <Skeleton />

  return (
    <>
      {/* Header */}
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl sm:text-[26px] font-medium tracking-tight text-[#020817]">
            Sponsor Dashboard
          </h1>
          <p className="mt-1 text-[13px] text-[#64748b]">
            Track your claimed spots, deliver artwork, and verify completion.
          </p>
        </div>
        <Link
          href="/browse"
          className="group inline-flex w-fit items-center gap-2 rounded-full bg-[#4166fb] px-5 py-2.5 text-[13px] font-medium text-white shadow-[0_10px_25px_-6px_rgba(65,102,251,0.4)] transition hover:bg-[#3558e8] active:scale-[0.98]"
        >
          <Palette size={15} />
          <span>Find ad spaces</span>
        </Link>
      </div>

      {toast && (
        <div
          role="status"
          className="mb-6 flex items-center justify-between rounded-xl bg-[#fafaf9] px-4 py-2.5 text-sm text-[#020817]"
        >
          <span>{toast}</span>
          <button onClick={() => setToast(undefined)} className="text-[#a1a1aa] hover:text-[#020817]">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Unboxed Stats Strip */}
      <section aria-label="Sponsor summary" className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3 lg:grid-cols-5">
        <MetricItem
          icon={<Handshake size={15} className="text-[#4166fb]" />}
          label="Active spots"
          value={String(data.summary.active)}
        />
        <MetricItem
          icon={<Clock3 size={15} className="text-amber-500" />}
          label="Awaiting approval"
          value={String(data.summary.pendingApproval)}
        />
        <MetricItem
          icon={<Palette size={15} className="text-purple-500" />}
          label="Needs artwork"
          value={String(data.summary.awaitingArtwork)}
        />
        <MetricItem
          icon={<Truck size={15} className="text-emerald-500" />}
          label="To verify"
          value={String(data.summary.delivering)}
        />
        <MetricItem
          icon={<CircleDollarSign size={15} className="text-slate-600" />}
          label="Committed"
          value={money(data.summary.committed, data.summary.currency)}
        />
      </section>

      {/* Two-Column Grid: Left (Campaigns) + Right (Escrow & Info Sidebar) */}
      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12 lg:items-start">
        {/* Left Column (8 cols): Sponsorships */}
        <section aria-labelledby="campaigns-title" className="lg:col-span-8">
          <div className="mb-3">
            <h2 id="campaigns-title" className="text-[15px] font-medium tracking-tight text-[#020817]">
              Your sponsorships
            </h2>
            <p className="text-[12px] text-[#64748b]">
              Track the status of your physical ad spots, submit artwork, and confirm proof.
            </p>
          </div>

          {data.campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-14 text-center">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#f1f0ec] text-[#64748b] mb-2.5">
                <Sparkles size={18} />
              </div>
              <p className="text-[14px] text-[#64748b]">You have not claimed an ad spot yet.</p>
              <Link
                href="/browse"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[#020817] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#1a2333] transition"
              >
                Browse ad spaces
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-[#ecebe6]/60">
              {data.campaigns.map((campaign) => (
                <CampaignRow
                  key={campaign.spotId}
                  campaign={campaign}
                  busy={busy === campaign.spotId}
                  disputing={disputing === campaign.spotId}
                  disputeReason={disputeReason}
                  onDisputeReason={setDisputeReason}
                  onStartDispute={() => {
                    setDisputing(campaign.spotId)
                    setDisputeReason('')
                  }}
                  onCancelDispute={() => {
                    setDisputing(null)
                    setDisputeReason('')
                  }}
                  onFile={(file) => uploadArtwork(campaign.spotId, file)}
                  onReview={(action) => void review(campaign.spotId, action)}
                />
              ))}
            </ul>
          )}
        </section>

        {/* Right Column (4 cols): Escrow Protection & Rules */}
        <aside className="lg:col-span-4 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[15px] font-medium tracking-tight text-[#020817]">
                Buyer Escrow Protection
              </h2>
              <span className="font-mono text-[11px] font-normal text-emerald-600">
                • Active
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-[#64748b]">
              Your funds remain locked in Solana escrow until proof of delivery is verified.
            </p>
          </div>

          <div className="divide-y divide-[#ecebe6]/60 border-t border-b border-[#ecebe6]">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px] text-[#64748b]">Total Committed</span>
              <span className="font-mono text-[15px] font-normal text-[#020817]">
                {money(data.summary.committed, data.summary.currency)}
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px] text-[#64748b]">Awaiting Approval</span>
              <span className="font-mono text-[14px] font-normal text-[#64748b]">
                {data.summary.pendingApproval} spots
              </span>
            </div>
            <div className="flex items-center justify-between py-2.5">
              <span className="text-[12px] text-[#64748b]">To Verify</span>
              <span className="font-mono text-[14px] font-normal text-[#64748b]">
                {data.summary.delivering} spots
              </span>
            </div>
          </div>

          <Link
            href="/browse"
            className="flex w-full items-center justify-center gap-1.5 rounded-full bg-[#020817] py-2 text-[13px] font-medium text-white transition hover:bg-[#1a2333] active:scale-[0.98]"
          >
            <span>Discover more spaces</span>
            <ArrowRight size={13} />
          </Link>
        </aside>
      </div>
    </>
  )
}

function CampaignRow({
  campaign,
  busy,
  disputing,
  disputeReason,
  onDisputeReason,
  onStartDispute,
  onCancelDispute,
  onFile,
  onReview,
}: {
  campaign: SponsorSpot
  busy: boolean
  disputing: boolean
  disputeReason: string
  onDisputeReason: (value: string) => void
  onStartDispute: () => void
  onCancelDispute: () => void
  onFile: (file: File | undefined) => void
  onReview: (action: 'confirm' | 'withdraw' | { dispute: string }) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const handle = campaign.sellerHandle.replace(/^@+/, '')

  return (
    <li className="flex flex-col gap-5 py-5 sm:py-6 lg:flex-row lg:items-center lg:justify-between transition hover:bg-black/[0.015] px-2 -mx-2 rounded-2xl">
      <div className="flex min-w-0 items-start gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={campaign.listingImage}
          alt=""
          className="h-16 w-16 shrink-0 rounded-2xl bg-[#f1f0ec] object-cover shadow-2xs"
        />
        <div className="min-w-0">
          <Link
            href={`/listings/${campaign.listingSlug}`}
            className="text-[15px] font-medium text-[#020817] hover:text-[#4166fb] transition leading-snug"
          >
            {campaign.listingTitle}
          </Link>
          <p className="mt-1 text-[13px] text-[#64748b]">
            <span className="font-normal text-[#020817]">{campaign.spotLabel}</span>
            {campaign.location ? ` · ${campaign.location}` : ''} ·{' '}
            {campaign.mode === 'auction' ? 'Auction win' : 'Fixed price'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2.5">
            <span className="text-[12px] text-[#64748b]">
              Creator:{' '}
              <Link href={`/${encodeURIComponent(handle)}`} className="font-normal text-[#4166fb] hover:underline">
                @{handle}
              </Link>
            </span>
            <span
              className={`inline-block text-[12px] font-normal ${STATUS_TONE[campaign.status]}`}
            >
              • {STATUS_LABEL[campaign.status]}
            </span>
          </div>
          {campaign.status === 'disputed' && campaign.disputeReason && (
            <p className="mt-2 text-xs text-red-600 bg-red-50/60 p-2 rounded-lg">
              Reported: {campaign.disputeReason}
            </p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-3 lg:w-[320px] lg:items-end">
        <p className="font-mono text-xl font-normal text-[#020817]">
          {money(campaign.amount, campaign.currency)}
        </p>

        {campaign.status === 'pending' && (
          <p className="text-[12px] text-[#64748b] lg:text-right">
            The creator reviews your spot before it goes into production.
          </p>
        )}

        {campaign.artworkDue && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => onFile(event.target.files?.[0])}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#3558e8] active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <UploadCloud size={14} />
              <span>{busy ? 'Uploading…' : campaign.artworkSubmittedAt ? 'Replace artwork' : 'Upload artwork'}</span>
            </button>
          </>
        )}

        {!campaign.artworkDue && campaign.artworkSubmittedAt && campaign.status !== 'delivered' && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
            <Check size={12} /> Artwork received
          </span>
        )}

        {(campaign.status === 'delivered' || campaign.status === 'disputed') && <Proof campaign={campaign} />}

        {campaign.status === 'delivered' && !disputing && (
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={() => onReview('confirm')}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
            >
              <Check size={14} />
              <span>{busy ? 'Saving…' : 'Approve delivery'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onStartDispute}
              className="rounded-full border border-[#d8d6d0] px-3.5 py-1.5 text-xs font-medium text-[#64748b] transition hover:text-[#020817] cursor-pointer"
            >
              Report a problem
            </button>
          </div>
        )}

        {disputing && (
          <div className="w-full lg:text-right">
            <label className="block text-xs font-medium text-[#020817]">
              What went wrong?
              <textarea
                value={disputeReason}
                maxLength={500}
                rows={3}
                onChange={(event) => onDisputeReason(event.target.value)}
                className="mt-1.5 block w-full rounded-xl border border-[#e8e7e1] p-3 text-xs outline-none focus:border-[#4166fb]"
              />
            </label>
            <div className="mt-3 flex gap-2 lg:justify-end">
              <button
                type="button"
                disabled={busy || !disputeReason.trim()}
                onClick={() => onReview({ dispute: disputeReason.trim() })}
                className="rounded-full bg-[#4166fb] px-4 py-1.5 text-xs font-semibold text-white shadow-2xs transition hover:bg-[#3558e8] disabled:opacity-50 cursor-pointer"
              >
                Send report
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onCancelDispute}
                className="rounded-full border border-[#d8d6d0] px-3.5 py-1.5 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {campaign.status === 'disputed' && !disputing && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onReview('withdraw')}
            className="rounded-full border border-[#d8d6d0] px-4 py-1.5 text-xs font-semibold cursor-pointer"
          >
            Withdraw report
          </button>
        )}

        {campaign.status === 'refunded' && (
          <p className="text-xs text-[#64748b] lg:text-right">Outbid on this auction — your funds were returned.</p>
        )}
        {campaign.status === 'paid' && (
          <p className="text-xs text-[#64748b] lg:text-right">Campaign complete and paid out.</p>
        )}
      </div>
    </li>
  )
}

function Proof({ campaign }: { campaign: SponsorSpot }) {
  if (!campaign.proofPhotos.length && !campaign.proofPost) {
    return <p className="text-xs text-[#64748b] lg:text-right">The seller has not uploaded delivery proof yet.</p>
  }
  return (
    <div className="w-full lg:text-right">
      <div className="flex flex-wrap gap-2 lg:justify-end">
        {campaign.proofPhotos.map((photo, index) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={index}
            src={photo}
            alt={`Delivery proof ${index + 1}`}
            className="h-14 w-14 rounded-xl object-cover shadow-2xs"
          />
        ))}
      </div>
      {campaign.proofPost && (
        <a
          href={campaign.proofPost}
          target="_blank"
          rel="noopener"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#4166fb] hover:underline"
        >
          <span>See campaign post</span>
          <ExternalLink size={12} />
        </a>
      )}
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

function Skeleton() {
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
      <div className="h-60 rounded-2xl bg-[#f4f3ef]" />
    </div>
  )
}
