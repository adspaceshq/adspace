'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { approveReviewListing, fetchReviewQueue, rejectReviewListing } from '@/lib/auth-api'
import { cardPhoto, sellerDisplay } from '@/lib/listings'
import type { ApiListing } from '@/lib/types'

export default function ReviewPage() {
  const auth = useAuthSession()
  const [queue, setQueue] = useState<ApiListing[] | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [reasons, setReasons] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!auth.authenticated) return
    try {
      setQueue(await fetchReviewQueue())
      setError(undefined)
    } catch (e) {
      setQueue(null)
      setError(e instanceof Error ? e.message : 'Could not load the review queue.')
    }
  }, [auth.authenticated])

  useEffect(() => {
    if (!auth.authenticated) return
    let cancelled = false
    fetchReviewQueue().then(
      (q) => { if (!cancelled) { setQueue(q); setError(undefined) } },
      (e) => { if (!cancelled) { setQueue(null); setError(e instanceof Error ? e.message : 'Could not load the review queue.') } },
    )
    return () => { cancelled = true }
  }, [auth.authenticated])

  const act = async (slug: string, action: 'approve' | 'reject') => {
    setBusy(slug)
    setError(undefined)
    try {
      if (action === 'approve') await approveReviewListing(slug)
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
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Listing', 'Seller', 'Spots', 'Reason (reject)', 'Action'].map(x => <th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{queue.map(l => (
                    <tr key={l.id} className="border-b border-[#e7e5e0] last:border-0">
                      <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="h-11 w-16 overflow-hidden bg-[#f1f0ec]">{(l.image || cardPhoto(l)) && <img src={l.image || cardPhoto(l)} alt="" className="h-full w-full object-cover" />}</div><span className="font-medium">{l.title}</span></div></td>
                      <td className="px-4 py-4">{sellerDisplay({ name: l.seller, handle: l.sellerHandle })}</td>
                      <td className="px-4 py-4 font-mono text-xs">{l.spots.length}</td>
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
