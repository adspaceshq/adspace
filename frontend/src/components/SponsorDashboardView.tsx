'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, CircleDollarSign, Clock3, ExternalLink, Handshake, Palette, Truck } from 'lucide-react'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { confirmSpotReceipt, disputeSpotDelivery, fetchSponsorDashboard, submitSpotArtwork, withdrawSpotDispute } from '@/lib/auth-api'
import type { SponsorDashboard, SponsorSpot, SponsorSpotStatus } from '@/lib/types'

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)

const STATUS_LABEL: Record<SponsorSpotStatus, string> = {
  pending: 'Awaiting seller approval',
  sold: 'Approved — in production',
  delivered: 'Delivered — verify',
  disputed: 'Reported',
  paid: 'Paid out',
  refunded: 'Outbid — refunded',
}

const STATUS_TONE: Record<SponsorSpotStatus, string> = {
  pending: 'text-amber-700 border-amber-200 bg-amber-50',
  sold: 'text-[#4166fb] border-[#c7d2fe] bg-[#eef2ff]',
  delivered: 'text-emerald-700 border-emerald-200 bg-emerald-50',
  disputed: 'text-red-700 border-red-200 bg-red-50',
  paid: 'text-[#020817] border-[#e7e5e0] bg-[#f6f5f2]',
  refunded: 'text-[#64748b] border-[#e7e5e0] bg-[#f6f5f2]',
}

const MAX_ARTWORK_BYTES = 3 * 1024 * 1024

/** Sponsor-side dashboard: what I bought, what needs my artwork, what is ready to verify. */
export default function SponsorDashboardView() {
  const auth = useAuthSession()
  const [data, setData] = useState<SponsorDashboard | null>(null)
  const [error, setError] = useState<string>()
  const [toast, setToast] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [disputing, setDisputing] = useState<string | null>(null)
  const [disputeReason, setDisputeReason] = useState('')

  const load = useCallback(async () => {
    try { setData(await fetchSponsorDashboard()); setError(undefined) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your sponsorships.') }
  }, [])

  useEffect(() => {
    if (!auth.authenticated) return
    let cancelled = false
    fetchSponsorDashboard().then(
      (loaded) => { if (!cancelled) { setData(loaded); setError(undefined) } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your sponsorships.') },
    )
    return () => { cancelled = true }
  }, [auth.authenticated])

  // Artwork intake is one image per spot, uploaded at full quality (API caps ~3 MB).
  const uploadArtwork = (spotId: string, file: File | undefined) => {
    if (!file || busy) return
    if (!file.type.startsWith('image/')) return setToast('Artwork must be an image file.')
    if (file.size > MAX_ARTWORK_BYTES) return setToast('Artwork must be under 3 MB.')
    setBusy(spotId); setToast(undefined)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      if (!dataUrl.startsWith('data:image/')) { setBusy(undefined); return setToast('Could not read that file.') }
      submitSpotArtwork(spotId, { logoUrl: dataUrl }).then(
        async () => { await load(); setBusy(undefined); setToast('Artwork submitted.') },
        (e) => { setBusy(undefined); setToast(e instanceof Error ? e.message : 'Could not submit artwork.') },
      )
    }
    reader.onerror = () => { setBusy(undefined); setToast('Could not read that file.') }
    reader.readAsDataURL(file)
  }

  const review = async (spotId: string, action: 'confirm' | 'withdraw' | { dispute: string }) => {
    setBusy(spotId); setToast(undefined)
    try {
      if (action === 'confirm') await confirmSpotReceipt(spotId)
      else if (action === 'withdraw') await withdrawSpotDispute(spotId)
      else await disputeSpotDelivery(spotId, action.dispute)
      setDisputing(null); setDisputeReason('')
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
      <section className="mx-auto max-w-xl py-24 text-center">
        <h1 className="text-[42px]">Sponsor dashboard</h1>
        <p className="mt-3 text-[#64748b]">Log in with X to track the spots you claimed, hand over artwork, and verify delivery.</p>
        <button onClick={auth.login} className="mt-7 rounded-lg bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]">Log in with X</button>
      </section>
    )
  }
  if (error) return <div role="alert" className="border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
  if (!data) return <Skeleton />

  return (
    <>
      <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-[clamp(38px,5vw,58px)]">Sponsor dashboard</h1>
          <p className="mt-1 text-[16px] text-[#64748b]">Track the spots you claimed, hand over artwork, and verify delivery.</p>
        </div>
        <Link href="/browse" className="inline-flex w-fit items-center gap-2 rounded-md bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]"><Palette size={17}/>Find ad space</Link>
      </div>

      {toast && <div role="status" className="mb-5 border border-[#e7e5e0] bg-white px-4 py-3 text-sm text-[#020817]">{toast}</div>}

      <section aria-label="Sponsor summary" className="mb-9 grid border border-[#e7e5e0] bg-white sm:grid-cols-2 lg:grid-cols-5">
        <Metric icon={<Handshake/>} label="Active spots" value={String(data.summary.active)}/>
        <Metric icon={<Clock3/>} label="Awaiting approval" value={String(data.summary.pendingApproval)}/>
        <Metric icon={<Palette/>} label="Needs artwork" value={String(data.summary.awaitingArtwork)}/>
        <Metric icon={<Truck/>} label="To verify" value={String(data.summary.delivering)}/>
        <Metric icon={<CircleDollarSign/>} label="Committed" value={money(data.summary.committed, data.summary.currency)}/>
      </section>

      <section aria-labelledby="campaigns-title" className="border border-[#e7e5e0] bg-white">
        <h2 id="campaigns-title" className="border-b border-[#e7e5e0] px-6 py-5 text-[24px]">Your sponsorships</h2>
        {data.campaigns.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-[#64748b]">
            You have not claimed a spot yet.
            <Link href="/browse" className="ml-2 font-semibold text-[#4166fb]">Browse ad spaces</Link>
          </div>
        ) : (
          <ul className="divide-y divide-[#e7e5e0]">
            {data.campaigns.map((campaign) => (
              <CampaignRow
                key={campaign.spotId}
                campaign={campaign}
                busy={busy === campaign.spotId}
                disputing={disputing === campaign.spotId}
                disputeReason={disputeReason}
                onDisputeReason={setDisputeReason}
                onStartDispute={() => { setDisputing(campaign.spotId); setDisputeReason('') }}
                onCancelDispute={() => { setDisputing(null); setDisputeReason('') }}
                onFile={(file) => uploadArtwork(campaign.spotId, file)}
                onReview={(action) => void review(campaign.spotId, action)}
              />
            ))}
          </ul>
        )}
      </section>
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
    <li className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={campaign.listingImage} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-[#e7e5e0] object-cover" />
        <div className="min-w-0">
          <Link href={`/listings/${campaign.listingSlug}`} className="font-[family-name:var(--font-display)] text-lg text-[#020817] underline-offset-4 hover:underline">{campaign.listingTitle}</Link>
          <p className="mt-0.5 text-sm text-[#64748b]">{campaign.spotLabel}{campaign.location ? ` · ${campaign.location}` : ''} · {campaign.mode === 'auction' ? 'Auction win' : 'Fixed price'}</p>
          <p className="mt-1 text-sm text-[#64748b]">Seller <Link href={`/${encodeURIComponent(handle)}`} className="font-medium text-[#4166fb]">@{handle}</Link></p>
          <span className={`mt-2 inline-block rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_TONE[campaign.status]}`}>{STATUS_LABEL[campaign.status]}</span>
          {campaign.status === 'disputed' && campaign.disputeReason && <p className="mt-2 text-xs text-[#64748b]">Your report: {campaign.disputeReason}</p>}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-start gap-3 lg:w-[320px] lg:items-end">
        <p className="font-mono text-lg">{money(campaign.amount, campaign.currency)}</p>

        {campaign.status === 'pending' && <p className="text-xs text-[#64748b] lg:text-right">The seller approves your spot before it goes live.</p>}

        {campaign.artworkDue && (
          <>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => onFile(event.target.files?.[0])} />
            <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="rounded-md bg-[#4166fb] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Uploading…' : campaign.artworkSubmittedAt ? 'Replace artwork' : 'Upload artwork'}
            </button>
          </>
        )}

        {!campaign.artworkDue && campaign.artworkSubmittedAt && campaign.status !== 'delivered' && <p className="text-xs text-[#64748b] lg:text-right">Artwork received</p>}

        {(campaign.status === 'delivered' || campaign.status === 'disputed') && <Proof campaign={campaign} />}

        {campaign.status === 'delivered' && !disputing && (
          <div className="flex flex-wrap gap-2 lg:justify-end">
            <button type="button" disabled={busy} onClick={() => onReview('confirm')} className="inline-flex items-center gap-1.5 rounded-md bg-[#4166fb] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Check size={15}/>{busy ? 'Saving…' : 'Approve delivery'}
            </button>
            <button type="button" disabled={busy} onClick={onStartDispute} className="rounded-md border border-[#d8d6d0] px-4 py-2.5 text-sm font-semibold">Report a problem</button>
          </div>
        )}

        {disputing && (
          <div className="w-full lg:text-right">
            <label className="block text-xs font-medium text-[#020817]">
              What went wrong?
              <textarea value={disputeReason} maxLength={500} rows={3} onChange={(event) => onDisputeReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm outline-none focus:border-[#4166fb]"/>
            </label>
            <div className="mt-3 flex gap-2 lg:justify-end">
              <button type="button" disabled={busy || !disputeReason.trim()} onClick={() => onReview({ dispute: disputeReason.trim() })} className="rounded-md bg-[#4166fb] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Send report</button>
              <button type="button" disabled={busy} onClick={onCancelDispute} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-sm font-semibold">Cancel</button>
            </div>
          </div>
        )}

        {campaign.status === 'disputed' && !disputing && (
          <button type="button" disabled={busy} onClick={() => onReview('withdraw')} className="rounded-md border border-[#d8d6d0] px-4 py-2.5 text-sm font-semibold">Withdraw report</button>
        )}

        {campaign.status === 'refunded' && <p className="text-xs text-[#64748b] lg:text-right">Another sponsor took this spot — your bid comes back to you.</p>}
        {campaign.status === 'paid' && <p className="text-xs text-[#64748b] lg:text-right">Campaign complete and paid out to the seller.</p>}
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
          <img key={index} src={photo} alt={`Delivery proof ${index + 1}`} className="h-14 w-14 rounded-lg border border-[#e7e5e0] object-cover"/>
        ))}
      </div>
      {campaign.proofPost && (
        <a href={campaign.proofPost} target="_blank" rel="noopener" className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#4166fb] underline">
          See the campaign post <ExternalLink size={13}/>
        </a>
      )}
    </div>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return <div className="flex items-center gap-4 border-b border-[#e7e5e0] px-6 py-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"><span className="text-[#405072] [&>svg]:h-6 [&>svg]:w-6 [&>svg]:stroke-[1.6]">{icon}</span><div><div className="text-xs text-[#64748b]">{label}</div><div className="mt-0.5 font-[family-name:var(--font-display)] text-2xl">{value}</div></div></div>
}

function Skeleton() {
  return <div className="animate-pulse space-y-7 py-6"><div className="h-20 w-2/5 bg-[#eeede8]"/><div className="h-24 border border-[#e7e5e0] bg-white"/><div className="h-72 border border-[#e7e5e0] bg-white"/></div>
}




