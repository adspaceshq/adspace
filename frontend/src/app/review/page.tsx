'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { approveReviewListing, fetchPayableQueue, fetchReviewQueue, payApiSpot, rejectReviewListing } from '@/lib/auth-api'
import { cardPhoto, explorerTxUrl, isSignatureLike, sellerDisplay } from '@/lib/listings'
import type { ApiListing, PayoutItem, ReviewPolicy } from '@/lib/types'

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency, maximumFractionDigits: 2,
}).format(amount)

export default function ReviewPage() {
  const auth = useAuthSession()
  const [queue, setQueue] = useState<ApiListing[] | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [payouts, setPayouts] = useState<PayoutItem[] | null>(null)
  const [payRefs, setPayRefs] = useState<Record<string, string>>({})
  const [payBusy, setPayBusy] = useState<string>()
  const [payError, setPayError] = useState<string>()
  const [approval, setApproval] = useState<ApiListing | null>(null)
  const [policy, setPolicy] = useState<ReviewPolicy | null>(null)

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
    return () => { cancelled = true }
  }, [auth.authenticated])

  const act = async (slug: string, action: 'approve' | 'reject') => {
    let succeeded = false
    setBusy(slug)
    setError(undefined)
    try {
      if (action === 'approve') {
        if (!policy) throw new Error('Review policy is required.')
        await approveReviewListing(slug, policy)
      }
      else {
        const reason = (reasons[slug] ?? '').trim()
        if (!reason) throw new Error('Enter a rejection reason first.')
        await rejectReviewListing(slug, reason)
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

  return (
    <>
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
            <div className="mb-7">
              <h1 className="text-[clamp(38px,5vw,58px)]">Platform review</h1>
              <p className="mt-1 text-[16px] text-[#64748b]">Approve submissions to go live, or reject them with a reason.</p>
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
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Listing', 'Seller', 'Mode', 'Spots', 'Reason (reject)', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{queue.map(l => (
                    <tr key={l.id} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="h-11 w-16 overflow-hidden bg-[#f1f0ec]">{(l.image || cardPhoto(l)) && <img src={l.image || cardPhoto(l)} alt="" className="h-full w-full object-cover" />}</div><span className="font-medium">{l.title}</span></div></td>
                      <td className="px-4 py-4">{sellerDisplay({ name: l.seller, handle: l.sellerHandle })}</td>
                      <td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.05em] ${l.mode === 'auction' ? 'bg-[#e9edfe] text-[#3154e8]' : 'bg-emerald-50 text-emerald-700'}`}>{l.mode === 'auction' ? 'Auction' : 'Fixed price'}</span></td>
                      <td className="px-4 py-4 font-mono text-xs">{l.spots.length}</td>
                      <td className="px-4 py-4"><input value={reasons[l.slug] ?? ''} onChange={(e) => setReasons((prev) => ({ ...prev, [l.slug]: e.target.value }))} placeholder="Why is it rejected?" maxLength={500} className="w-full min-w-[200px] rounded-lg border border-[#e7e5e0] px-3 py-2 text-[13px] outline-none transition focus:border-[#4166fb]" /></td>
                      <td className="px-4 py-4"><div className="flex gap-2">
                        <button disabled={busy === l.slug} onClick={() => { setApproval(l); setPolicy({ platformFeeBps:250, upliftFeeBps:l.mode === 'auction' ? 1000 : 0, maxFeeBps:l.mode === 'auction' ? 1000 : 250, settlementWindowHours:48, deliveryDeadline:new Date(Date.now()+7*86400000).toISOString().slice(0,16) }) }} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Review & approve</button>
                        <button disabled={busy === l.slug} onClick={() => void act(l.slug, 'reject')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold text-[#dc2626] disabled:opacity-50">Reject</button>
                      </div></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {approval && policy && (
              <div role="dialog" aria-modal="true" aria-labelledby="approval-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/50 p-6" onClick={() => { if (busy !== approval.slug) setApproval(null) }}>
                <div className="max-h-[85vh] w-full max-w-[560px] overflow-y-auto rounded-2xl bg-white p-8 shadow-[0_24px_64px_rgba(2,8,23,0.28)]" onClick={(event) => event.stopPropagation()}>
                  <h2 id="approval-title" className="text-[24px]">Approve {approval.mode === 'auction' ? 'auction' : 'fixed-price listing'}?</h2>
                  <p className="mt-1 text-sm text-[#64748b]">Review the commercial terms before sending this offer to the seller.</p>
                  <dl className="mt-6 space-y-3 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-[#64748b]">Listing</dt><dd className="font-semibold">{approval.title}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-[#64748b]">Seller</dt><dd className="font-semibold">{sellerDisplay({ name: approval.seller, handle: approval.sellerHandle })}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-[#64748b]">Pricing model</dt><dd className="font-semibold">{approval.mode === 'auction' ? 'Auction' : 'Fixed price'}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-[#64748b]">Deadline</dt><dd className="font-semibold">{new Date(approval.deadline).toLocaleString()}</dd></div>
                    {approval.mode === 'auction' && (
                      <div className="flex justify-between gap-4"><dt className="text-[#64748b]">Bid uplift</dt><dd className="font-semibold">{approval.doubleUp ? 'Double current bid' : approval.minIncrement ? `At least ${money(approval.minIncrement, approval.currency)}` : 'Program policy minimum'}</dd></div>
                    )}
                  </dl>
                  <div className="mt-5 rounded-xl border border-[#e7e5e0]">
                    {approval.spots.map((spot) => (
                      <div key={spot.id} className="flex items-center justify-between gap-4 border-b border-[#e7e5e0] px-4 py-3 text-sm last:border-0">
                        <span className="font-medium">{spot.label}</span>
                        <span className="font-mono text-xs text-[#64748b]">{approval.mode === 'auction' ? 'Starts at ' : ''}{money(spot.price, approval.currency)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5 grid gap-4 sm:grid-cols-3">
                    <label className="text-xs font-semibold">Platform fee (%)<input type="number" min="0" max="100" step="0.01" value={policy.platformFeeBps/100} onChange={(e)=>setPolicy({...policy,platformFeeBps:Math.round(Number(e.target.value)*100)})} className="mt-1 w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm" /></label>
                    {approval.mode === 'auction' && <label className="text-xs font-semibold">Uplift fee (%)<input type="number" min="0" max="100" step="0.01" value={policy.upliftFeeBps/100} onChange={(e)=>setPolicy({...policy,upliftFeeBps:Math.round(Number(e.target.value)*100)})} className="mt-1 w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm" /></label>}
                    {approval.mode === 'auction' && <label className="text-xs font-semibold">Maximum fee (%)<input type="number" min="0" max="100" step="0.01" value={policy.maxFeeBps/100} onChange={(e)=>setPolicy({...policy,maxFeeBps:Math.round(Number(e.target.value)*100)})} className="mt-1 w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm" /></label>}
                    <label className="text-xs font-semibold">Settlement window (hours)<input type="number" min="1" step="1" value={policy.settlementWindowHours} onChange={(e)=>setPolicy({...policy,settlementWindowHours:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm" /></label>
                    <label className="text-xs font-semibold sm:col-span-2">Delivery deadline<input type="datetime-local" value={policy.deliveryDeadline} onChange={(e)=>setPolicy({...policy,deliveryDeadline:e.target.value})} className="mt-1 w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm" /></label>
                  </div>
                  <p className="mt-4 rounded-lg bg-[#f8fafc] px-4 py-3 text-xs leading-relaxed text-[#64748b]">Approval does not create anything on-chain. The listing and spots are created only after the seller reviews and accepts these terms.</p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button type="button" disabled={busy === approval.slug} onClick={() => setApproval(null)} className="rounded-md border border-[#d8d6d0] px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Cancel</button>
                    <button type="button" disabled={busy === approval.slug} onClick={() => void act(approval.slug, 'approve').then((ok) => { if (ok) setApproval(null) })} className="rounded-md bg-[#4166fb] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{busy === approval.slug ? 'Approving…' : `Approve ${approval.mode === 'auction' ? 'auction' : 'listing'}`}</button>
                  </div>
                </div>
              </div>
            )}
            <div className="mb-7 mt-12">
              <h2 className="text-[28px]">Payouts</h2>
              <p className="mt-1 text-[14px] text-[#64748b]">Released spots awaiting manual USDC. Send the transfer from your wallet, then paste the transaction signature to record it.</p>
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
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Spot', 'Seller', 'Buyer', 'Amount', 'Tx signature', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{payouts.map(p => (
                    <tr key={p.spotId} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><Link href={`/listings/${p.listingSlug}`} className="font-medium text-[#4166fb]">{p.listingTitle} · {p.spotLabel}</Link></td>
                      <td className="px-4 py-4 font-mono text-xs">{p.seller}</td>
                      <td className="px-4 py-4 font-mono text-xs">{p.buyer}</td>
                      <td className="px-4 py-4 font-mono text-xs">{p.amount} {p.currency}</td>
                      <td className="px-4 py-4"><input value={payRefs[p.spotId] ?? ''} onChange={(e) => setPayRefs((prev) => ({ ...prev, [p.spotId]: e.target.value }))} placeholder="Solana tx signature" spellCheck={false} className="w-full min-w-[220px] rounded-lg border border-[#e7e5e0] px-3 py-2 font-mono text-[12px] outline-none transition focus:border-[#4166fb]" /></td>
                      <td className="px-4 py-4"><button disabled={payBusy === p.spotId || !isSignatureLike((payRefs[p.spotId] ?? '').trim())} onClick={() => void (async () => {
                        setPayBusy(p.spotId); setPayError(undefined)
                        try {
                          const paid = await payApiSpot(p.spotId, (payRefs[p.spotId] ?? '').trim())
                          setPayRefs((prev) => { const next = { ...prev }; delete next[p.spotId]; return next })
                          await load()
                          if (paid.payoutReference) window.open(explorerTxUrl(paid.payoutReference), '_blank', 'noopener')
                        } catch (e) { setPayError(e instanceof Error ? e.message : 'Payout failed.') }
                        finally { setPayBusy(undefined) }
                      })()} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Record payout</button></td>
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
      <Footer />
    </>
  )
}
