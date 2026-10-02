'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PageShell from '@/components/PageShell'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { approveReviewListing, fetchDisputeQueue, fetchPayableQueue, fetchReviewQueue, payApiSpot, reconcileChain, rejectReviewListing, resolveSpotDispute } from '@/lib/auth-api'
import { cardPhoto, explorerTxUrl, sellerDisplay } from '@/lib/listings'
import type { ApiListing, DisputeItem, PayoutItem, ReviewPolicyRequest } from '@/lib/types'

const defaultPolicy = (listing: ApiListing): ReviewPolicyRequest => ({
  feeBps: 250,
  upliftFeeBps: listing.mode === 'auction' ? 250 : 0,
  maxFeeBps: 250,
  reviewWindowSeconds: 172800,
  deliveryDeadline: new Date(new Date(listing.artworkClose || listing.deadline).getTime() + 7 * 86_400_000).toISOString(),
})

export default function ReviewPage() {
  const auth = useAuthSession()
  const [queue, setQueue] = useState<ApiListing[] | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [policies, setPolicies] = useState<Record<string, ReviewPolicyRequest>>({})
  const [payouts, setPayouts] = useState<PayoutItem[] | null>(null)
  const [payBusy, setPayBusy] = useState<string>()
  const [payError, setPayError] = useState<string>()
  const [disputes, setDisputes] = useState<DisputeItem[] | null>(null)
  const [resolutionShares, setResolutionShares] = useState<Record<string, number>>({})
  const [decisions, setDecisions] = useState<Record<string, string>>({})
  const [resolutionBusy, setResolutionBusy] = useState<string>()
  const [resolutionError, setResolutionError] = useState<string>()
  const [reconciling,setReconciling]=useState(false)
  const [reconcileNote,setReconcileNote]=useState<string>()

  const load = useCallback(async () => {
    if (!auth.authenticated) return
    try {
      setQueue(await fetchReviewQueue())
      setError(undefined)
    } catch (e) {
      setQueue(null)
      setError(e instanceof Error ? e.message : 'Could not load the review queue.')
    }
    try {
      setPayouts(await fetchPayableQueue())
      setPayError(undefined)
    } catch (e) {
      setPayouts(null)
      setPayError(e instanceof Error ? e.message : 'Could not load the payout queue.')
    }
    try {
      setDisputes(await fetchDisputeQueue())
      setResolutionError(undefined)
    } catch (e) {
      setDisputes(null)
      setResolutionError(e instanceof Error ? e.message : 'Could not load disputes.')
    }
  }, [auth.authenticated])

  useEffect(() => {
    if (!auth.authenticated) return
    let cancelled = false
    fetchReviewQueue().then(
      (q) => { if (!cancelled) { setQueue(q); setError(undefined) } },
      (e) => { if (!cancelled) { setQueue(null); setError(e instanceof Error ? e.message : 'Could not load the review queue.') } },
    )
    fetchPayableQueue().then(
      (p) => { if (!cancelled) { setPayouts(p); setPayError(undefined) } },
      (e) => { if (!cancelled) { setPayouts(null); setPayError(e instanceof Error ? e.message : 'Could not load the payout queue.') } },
    )
    fetchDisputeQueue().then(
      (items) => { if (!cancelled) { setDisputes(items); setResolutionError(undefined) } },
      (e) => { if (!cancelled) { setDisputes(null); setResolutionError(e instanceof Error ? e.message : 'Could not load disputes.') } },
    )
    return () => { cancelled = true }
  }, [auth.authenticated])

  const act = async (slug: string, action: 'approve' | 'reject') => {
    setBusy(slug)
    setError(undefined)
    try {
      if (action === 'approve') {
        const listing = queue?.find((item) => item.slug === slug)
        if (!listing) throw new Error('Listing is no longer in the review queue.')
        await approveReviewListing(slug, policies[slug] ?? defaultPolicy(listing))
      }
      else await rejectReviewListing(slug, reasons[slug] ?? '')
      setReasons((prev) => {
        const next = { ...prev }
        delete next[slug]
        return next
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.')
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <>
      <PageShell>
        <Header />
        <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-20 pt-8 md:pt-12">
        {!auth.ready ? (
          <p className="py-24 text-center text-[#64748b]">Loading…</p>
        ) : !auth.authenticated ? (
          <section className="mx-auto max-w-xl py-24 text-center">
            <h1 className="text-[42px]">Platform review</h1>
            <p className="mt-3 text-[#64748b]">Log in with X to see submissions awaiting review.</p>
            <button onClick={auth.login} className="mt-7 rounded-lg bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]">Log in with X</button>
          </section>
        ) : (
          <>
            <div className="mb-7 flex items-end justify-between gap-4">
              <div>
              <h1 className="text-[clamp(38px,5vw,58px)]">Platform review</h1>
              <p className="mt-1 text-[16px] text-[#64748b]">Approve submissions to go live, or reject them with a reason.</p>
              {reconcileNote&&<p className="mt-2 text-xs text-[#64748b]">{reconcileNote}</p>}
              </div>
              <button disabled={reconciling} onClick={()=>void(async()=>{setReconciling(true);setReconcileNote(undefined);try{const r=await reconcileChain();setReconcileNote(`Checked ${r.checked}, updated ${r.updated}, missing ${r.missing}.`);await load()}catch(e){setReconcileNote(e instanceof Error?e.message:'Reconciliation failed.')}finally{setReconciling(false)}})()} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">{reconciling?'Syncing...':'Sync devnet'}</button>
            </div>
            {error && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
            {queue === null ? (
              !error && <p className="py-12 text-center text-[#64748b]">Loading queue…</p>
            ) : queue.length === 0 ? (
              <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
                <h3 className="text-xl">Queue is clear.</h3>
                <p className="mt-2 text-sm text-[#64748b]">No submissions awaiting review.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Listing', 'Seller', 'Spots', 'On-chain policy', 'Reason (reject)', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{queue.map(l => (
                    <tr key={l.id} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="h-11 w-16 overflow-hidden bg-[#f1f0ec]">{(l.image || cardPhoto(l)) && <img src={l.image || cardPhoto(l)} alt="" className="h-full w-full object-cover" />}</div><span className="font-medium">{l.title}</span></div></td>
                      <td className="px-4 py-4">{sellerDisplay({ name: l.seller, handle: l.sellerHandle })}</td>
                      <td className="px-4 py-4 font-mono text-xs">{l.spots.length}</td>
                      <td className="px-4 py-4"><div className="grid min-w-[250px] grid-cols-3 gap-2">
                        {(['feeBps', 'maxFeeBps', 'upliftFeeBps'] as const).map((field) => {
                          const policy = policies[l.slug] ?? defaultPolicy(l)
                          return <label key={field} className="text-[10px] text-[#64748b]">{field.replace('Bps', '')}<input type="number" min={0} max={10000} value={policy[field]} onChange={(e) => setPolicies((prev) => ({ ...prev, [l.slug]: { ...policy, [field]: Number(e.target.value) } }))} className="mt-1 w-full rounded border border-[#e7e5e0] px-2 py-1 text-xs text-black" /></label>
                        })}
                        <label className="col-span-3 text-[10px] text-[#64748b]">Settlement window (hours)<input type="number" min={1} value={(policies[l.slug] ?? defaultPolicy(l)).reviewWindowSeconds / 3600} onChange={(e) => { const policy = policies[l.slug] ?? defaultPolicy(l); setPolicies((prev) => ({ ...prev, [l.slug]: { ...policy, reviewWindowSeconds: Number(e.target.value) * 3600 } })) }} className="mt-1 w-full rounded border border-[#e7e5e0] px-2 py-1 text-xs text-black" /></label>
                        <label className="col-span-3 text-[10px] text-[#64748b]">Delivery deadline<input type="datetime-local" value={(policies[l.slug] ?? defaultPolicy(l)).deliveryDeadline.slice(0, 16)} onChange={(e) => { const policy = policies[l.slug] ?? defaultPolicy(l); setPolicies((prev) => ({ ...prev, [l.slug]: { ...policy, deliveryDeadline: new Date(e.target.value).toISOString() } })) }} className="mt-1 w-full rounded border border-[#e7e5e0] px-2 py-1 text-xs text-black" /></label>
                      </div></td>
                      <td className="px-4 py-4"><input value={reasons[l.slug] ?? ''} onChange={(e) => setReasons((prev) => ({ ...prev, [l.slug]: e.target.value }))} placeholder="Why is it rejected?" maxLength={500} className="w-full min-w-[200px] rounded-lg border border-[#e7e5e0] px-3 py-2 text-[13px] outline-none transition focus:border-[#4166fb]" /></td>
                      <td className="px-4 py-4"><div className="flex gap-2">
                        <button disabled={busy === l.slug} onClick={() => void act(l.slug, 'approve')} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button>
                        <button disabled={busy === l.slug} onClick={() => void act(l.slug, 'reject')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold text-[#dc2626] disabled:opacity-50">Reject</button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="mb-7 mt-12">
              <h2 className="text-[28px]">Disputes</h2>
              <p className="mt-1 text-[14px] text-[#64748b]">Resolve disputed escrow by assigning the seller share. The buyer receives the remainder.</p>
            </div>
            {resolutionError && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{resolutionError}</div>}
            {disputes === null ? (
              !resolutionError && <p className="py-12 text-center text-[#64748b]">Loading disputes...</p>
            ) : disputes.length === 0 ? (
              <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center"><h3 className="text-xl">No open disputes.</h3></div>
            ) : (
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Spot', 'Seller', 'Buyer', 'Reason', 'Seller share (bps)', 'Decision', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{disputes.map(d => (
                    <tr key={d.spotId} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><Link href={`/listings/${d.listingSlug}`} className="font-medium text-[#4166fb]">{d.listingTitle} · {d.spotLabel}</Link></td>
                      <td className="px-4 py-4 font-mono text-xs">{d.seller}</td>
                      <td className="px-4 py-4 font-mono text-xs">{d.buyer}</td>
                      <td className="max-w-[220px] px-4 py-4 text-xs">{d.reason || 'No reason provided'}</td>
                      <td className="px-4 py-4"><input type="number" min={0} max={10000} value={resolutionShares[d.spotId] ?? 5000} onChange={(e) => setResolutionShares(prev => ({ ...prev, [d.spotId]: Number(e.target.value) }))} className="w-28 rounded border border-[#e7e5e0] px-2 py-2 text-xs" /></td>
                      <td className="px-4 py-4"><input value={decisions[d.spotId] ?? ''} onChange={(e) => setDecisions(prev => ({ ...prev, [d.spotId]: e.target.value }))} placeholder="Resolution decision" maxLength={500} className="min-w-[200px] rounded border border-[#e7e5e0] px-3 py-2 text-xs" /></td>
                      <td className="px-4 py-4"><button disabled={resolutionBusy === d.spotId || !(decisions[d.spotId] ?? '').trim()} onClick={() => void (async () => {
                        setResolutionBusy(d.spotId); setResolutionError(undefined)
                        try { await resolveSpotDispute(d.spotId, resolutionShares[d.spotId] ?? 5000, decisions[d.spotId].trim()); await load() }
                        catch (e) { setResolutionError(e instanceof Error ? e.message : 'Resolution failed.') }
                        finally { setResolutionBusy(undefined) }
                      })()} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Resolve on-chain</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <div className="mb-7 mt-12">
              <h2 className="text-[28px]">Payouts</h2>
              <p className="mt-1 text-[14px] text-[#64748b]">Released spots awaiting on-chain settlement. The program splits the seller payout and platform fee from escrow.</p>
            </div>
            {payError && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{payError}</div>}
            {payouts === null ? (
              !payError && <p className="py-12 text-center text-[#64748b]">Loading payouts…</p>
            ) : payouts.length === 0 ? (
              <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
                <h3 className="text-xl">Nothing to pay.</h3>
                <p className="mt-2 text-sm text-[#64748b]">No released-but-unpaid spots.</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Spot', 'Seller', 'Buyer', 'Amount', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{payouts.map(p => (
                    <tr key={p.spotId} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><Link href={`/listings/${p.listingSlug}`} className="font-medium text-[#4166fb]">{p.listingTitle} · {p.spotLabel}</Link></td>
                      <td className="px-4 py-4 font-mono text-xs">{p.seller}</td>
                      <td className="px-4 py-4 font-mono text-xs">{p.buyer}</td>
                      <td className="px-4 py-4 font-mono text-xs">{p.amount} {p.currency}</td>
                      <td className="px-4 py-4"><button disabled={payBusy === p.spotId} onClick={() => void (async () => {
                        setPayBusy(p.spotId); setPayError(undefined)
                        try {
                          const paid = await payApiSpot(p.spotId, '')
                          await load()
                          if (paid.payoutReference) window.open(explorerTxUrl(paid.payoutReference), '_blank', 'noopener')
                        } catch (e) { setPayError(e instanceof Error ? e.message : 'Payout failed.') }
                        finally { setPayBusy(undefined) }
                      })()} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Settle on-chain</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            <p className="mt-6 text-center text-sm text-[#64748b]">
              <Link href="/dashboard" className="font-medium text-[#4166fb]">Back to dashboard</Link>
            </p>
          </>
        )}
      </main>
    </PageShell>
    <Footer />
  </>
)
}
