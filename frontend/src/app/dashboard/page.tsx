'use client'

import { useCallback, useEffect, useState } from 'react'
import { useMfa, useMfaEnrollment } from '@privy-io/react-auth'
import Link from 'next/link'
import { ArrowRight, CircleDollarSign, Clock3, LayoutGrid, Plus, Rows3, Wallet } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { useStore } from '@/components/StoreProvider'
import { acceptListingTerms, approveApiSpot, closeApiListing, confirmWalletWithdrawal, createWalletWithdrawal, deleteApiListing, executeWalletWithdrawal, failWalletWithdrawal, fetchSellerDashboard, fetchTerms, fetchWalletWithdrawals, fulfillApiSpot, rejectApiSpot, reopenApiListing } from '@/lib/auth-api'
import { cardPhoto, isEnded } from '@/lib/listings'
import type { SellerDashboard, TermsDoc, WalletWithdrawal } from '@/lib/types'
import { embeddedUsdcBalance } from '@/lib/adspaces-program'

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
const relative = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function DashboardPage() {
  const auth = useAuthSession()
  const { refresh } = useStore()
  const [data, setData] = useState<SellerDashboard | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [terms, setTerms] = useState<TermsDoc | null>(null)
  const [termsFor, setTermsFor] = useState<string | null>(null)
  const [termsError, setTermsError] = useState<string>()
  const { clear: clearMfa, promptMfa, mfaMethods } = useMfa()
  const { showMfaEnrollmentModal } = useMfaEnrollment()
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [withdrawAddress, setWithdrawAddress] = useState('')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawError, setWithdrawError] = useState<string>()
  const [withdrawSignature, setWithdrawSignature] = useState<string>()
  const [withdrawing, setWithdrawing] = useState(false)
  const [walletUsdc, setWalletUsdc] = useState<number>()
  const [withdrawals, setWithdrawals] = useState<WalletWithdrawal[]>([])

  const load = useCallback(async () => {
    if (!auth.authenticated) return
    try { setData(await fetchSellerDashboard()); setError(undefined) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load your dashboard.') }
  }, [auth.authenticated])
  useEffect(() => {
    if (!auth.authenticated) return
    let cancelled = false
    fetchSellerDashboard().then(
      (d) => { if (!cancelled) { setData(d); setError(undefined) } },
      (e) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your dashboard.') },
    )
    return () => { cancelled = true }
  }, [auth.authenticated])
  useEffect(() => {
    if (!auth.walletAddress) return
    let cancelled = false
    void embeddedUsdcBalance(auth.walletAddress).then((balance) => {
      if (!cancelled) setWalletUsdc(balance)
    })
    return () => { cancelled = true }
  }, [auth.walletAddress])
  useEffect(() => {
    if (!auth.authenticated) return
    void fetchWalletWithdrawals().then(setWithdrawals).catch(() => setWithdrawals([]))
  }, [auth.authenticated])

  const act = async (spotId: string, action: 'approve' | 'reject' | 'fulfill') => {
    setBusy(spotId); setError(undefined)
    try {
      if (action === 'approve') await approveApiSpot(spotId)
      else if (action === 'reject') await rejectApiSpot(spotId)
      else await fulfillApiSpot(spotId)
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(undefined) }
  }

  const actListing = async (slug: string, action: 'close' | 'reopen' | 'delete') => {
    if (action === 'delete' && !window.confirm('Delete this listing forever? Spots and bids go with it.')) return
    setBusy(slug); setError(undefined)
    try {
      if (action === 'close') await closeApiListing(slug)
      else if (action === 'reopen') await reopenApiListing(slug)
      else await deleteApiListing(slug)
      await load()
      await refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Action failed.') }
    finally { setBusy(undefined) }
  }

  const openTerms = async (slug: string) => {
    setTermsFor(slug); setTermsError(undefined)
    if (terms) return
    try {
      setTerms(await fetchTerms())
    } catch (e) { setTermsError(e instanceof Error ? e.message : 'Could not load the terms.') }
  }

  const accept = async () => {
    if (!termsFor || !terms) return
    setBusy(termsFor); setTermsError(undefined)
    try {
      await acceptListingTerms(termsFor, terms.version)
      setTermsFor(null)
      await load()
      await refresh()
    } catch (e) { setTermsError(e instanceof Error ? e.message : 'Could not accept the terms.') }
    finally { setBusy(undefined) }
  }

  const withdraw = async () => {
    if (!auth.walletDelegated) {
      setWithdrawError('Enable gasless transactions from your profile before withdrawing.')
      return
    }
    setWithdrawing(true); setWithdrawError(undefined); setWithdrawSignature(undefined)
    let intent: WalletWithdrawal | undefined
    let submittedSignature: string | undefined
    try {
      if (mfaMethods.length === 0) {
        showMfaEnrollmentModal()
        throw new Error('Set up two-factor authentication before withdrawing')
      }
      await clearMfa()
      await promptMfa()
      intent = await createWalletWithdrawal(withdrawAddress.trim(), Number(withdrawAmount))
      setWithdrawals((current) => [intent!, ...current])
      const confirmed = await executeWalletWithdrawal(intent.id)
      submittedSignature = confirmed.signature
      setWithdrawals((current) => current.map((item) => item.id === confirmed.id ? confirmed : item))
      setWithdrawSignature(confirmed.signature)
      setWithdrawAmount('')
      if (auth.walletAddress) setWalletUsdc(await embeddedUsdcBalance(auth.walletAddress))
    } catch (e) {
      if (intent && !submittedSignature) {
        void failWalletWithdrawal(intent.id).then((failed) => {
          setWithdrawals((current) => current.map((item) => item.id === failed.id ? failed : item))
        }).catch(() => undefined)
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

  return <>
    <Header />
    <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-20 pt-8 md:pt-12">
      {!auth.ready ? <DashboardSkeleton /> : !auth.authenticated ? (
        <section className="mx-auto max-w-xl py-24 text-center">
          <h1 className="text-[42px]">Seller dashboard</h1>
          <p className="mt-3 text-[#64748b]">Log in with X to manage your listings, buyers, and fulfillment.</p>
          <button onClick={auth.login} className="mt-7 rounded-lg bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]">Log in with X</button>
        </section>
      ) : (
        <>
          <div className="mb-7 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
            <div><h1 className="text-[clamp(38px,5vw,58px)]">Seller dashboard</h1><p className="mt-1 text-[16px] text-[#64748b]">Manage your spaces, buyers, and fulfillment.{auth.isReviewer && <> <Link href="/review" className="font-medium text-[#4166fb]">Review queue →</Link></>}</p></div>
            <Link href="/list" className="inline-flex w-fit items-center gap-2 rounded-md bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]"><Plus size={17}/>List a new space</Link>
          </div>
          {error && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {!data ? <DashboardSkeleton /> : <>
            <section aria-label="Seller summary" className="mb-9 grid border border-[#e7e5e0] bg-white sm:grid-cols-2 lg:grid-cols-5">
              <Metric icon={<LayoutGrid/>} label="Active listings" value={String(data.summary.activeListings)}/>
              <Metric icon={<Rows3/>} label="Open spots" value={String(data.summary.openSpots)}/>
              <Metric icon={<Clock3/>} label="Pending approval" value={String(data.summary.pendingApproval)}/>
              <Metric icon={<CircleDollarSign/>} label="Revenue" value={money(data.summary.revenue, data.summary.currency)}/>
              <Metric icon={<CircleDollarSign/>} label="Paid out" value={money(data.summary.paidOut ?? 0, data.summary.currency)}/>
            </section>

            <section aria-labelledby="withdrawals-title" className="mb-10 border border-[#e7e5e0] bg-white p-6">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-center">
                <div className="flex min-w-0 items-start gap-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#eef2ff] text-[#4166fb]"><Wallet size={20}/></span>
                  <div className="min-w-0">
                    <h2 id="withdrawals-title" className="text-[24px]">Withdrawals</h2>
                    <p className="mt-1 text-sm text-[#64748b]">Released USDC is settled directly to your Privy embedded wallet.</p>
                    <p className="mt-3 break-all font-mono text-xs text-[#020817]">{auth.walletAddress}</p>
                  </div>
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-8 md:text-right">
                  <div><p className="text-xs text-[#64748b]">Wallet USDC</p><p className="mt-1 font-mono text-lg">{walletUsdc === undefined ? 'Loading' : `$${walletUsdc.toFixed(2)}`}</p></div>
                  <div><p className="text-xs text-[#64748b]">Pending settlement</p><p className="mt-1 font-mono text-lg">{money(Math.max(0, data.summary.revenue - (data.summary.paidOut ?? 0)), data.summary.currency)}</p></div>
                  <div><p className="text-xs text-[#64748b]">Withdrawn</p><p className="mt-1 font-mono text-lg">{money(data.summary.paidOut ?? 0, data.summary.currency)}</p></div>
                </div>
              </div>
              <div className="mt-5 flex flex-col justify-between gap-3 border-t border-[#e7e5e0] pt-4 sm:flex-row sm:items-center">
                <p className="text-xs text-[#64748b]">Seller settlements arrive here automatically. You can transfer wallet USDC to another Solana address.</p>
                <button type="button" onClick={() => { setWithdrawOpen(true); setWithdrawError(undefined); setWithdrawSignature(undefined) }} className="shrink-0 rounded-md bg-[#020817] px-5 py-2.5 text-sm font-semibold text-white">Withdraw USDC</button>
              </div>
            </section>

            <section className="mb-10">
              <div className="mb-3 flex items-end justify-between"><h2 className="text-[28px]">Your listings</h2><Link href="/browse" className="flex items-center gap-1 text-sm font-medium text-[#4166fb]">View marketplace <ArrowRight size={15}/></Link></div>
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Listing','Status','Spots sold / open','Pricing mode','Revenue','Action'].map(x=><th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{data.listings.map(l=><tr key={l.id} className="border-b border-[#e7e5e0] last:border-0">
                    <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="h-11 w-16 overflow-hidden bg-[#f1f0ec]">{cardPhoto(l) && <img src={cardPhoto(l)} alt="" className="h-full w-full object-cover"/>}</div><span className="font-medium">{l.title}{l.reviewNote && <span className="mt-1 block max-w-[280px] text-[12px] font-normal text-[#dc2626]">Review: {l.reviewNote}</span>}</span></div></td>
                    <td className="px-4 py-4"><span className={`inline-flex items-center gap-2 text-xs font-medium ${l.status==='active'?(isEnded(l.deadline)?'text-[#64748b]':'text-emerald-700'):l.status==='approved'?'text-[#4166fb]':l.status==='submitted'?'text-amber-700':'text-[#64748b]'}`}><span className={`h-1.5 w-1.5 rounded-full ${l.status==='active'?(isEnded(l.deadline)?'bg-slate-400':'bg-emerald-500'):l.status==='approved'?'bg-[#4166fb]':l.status==='submitted'?'bg-amber-500':'bg-slate-400'}`}/>{l.status==='active'?(isEnded(l.deadline)?'Ended':'Active'):l.status==='approved'?'Approved':l.status==='submitted'?'Submitted':'Closed'}</span>{l.status==='submitted'&&<span className="mt-1 block text-[11px] font-normal text-[#64748b]">Awaiting review</span>}{l.status==='approved'&&<span className="mt-1 block text-[11px] font-normal text-[#64748b]">Accept terms to go live</span>}{l.status==='active'&&isEnded(l.deadline)&&<span className="mt-1 block text-[11px] font-normal text-[#64748b]">Deadline passed</span>}</td>
                    <td className="px-4 py-4 font-mono text-xs">{l.sold} / {l.open}</td><td className="px-4 py-4 capitalize">{l.mode==='fixed'?'Fixed price':'Auction'}</td><td className="px-4 py-4 font-mono text-xs">{money(l.revenue,l.currency)}</td>
                    <td className="px-4 py-4"><div className="flex gap-2">{l.status==='active'&&<Link href={`/listings/${l.slug}`} className="inline-flex rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold hover:border-[#4166fb]">View</Link>}{l.status==='approved'&&<button disabled={busy===l.slug} onClick={()=>void openTerms(l.slug)} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Review terms</button>}{l.status!=='closed'
                      ? <button disabled={busy===l.slug} onClick={()=>void actListing(l.slug,'close')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">Close</button>
                      : <button disabled={busy===l.slug} onClick={()=>void actListing(l.slug,'reopen')} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Resubmit</button>}<button disabled={busy===l.slug} onClick={()=>void actListing(l.slug,'delete')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold text-[#dc2626] disabled:opacity-50">Delete</button></div></td>
                  </tr>)}</tbody>
                </table>
                {data.listings.length===0 && <Empty text="You haven’t listed a space yet." action="List your first space" href="/list"/>}
              </div>
            </section>

            <section>
              <h2 className="text-[28px]">Needs your attention</h2><p className="mb-3 text-sm text-[#64748b]">Review incoming claims and bids, then mark approved campaigns as fulfilled.</p>
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm"><thead className="text-[12px] text-[#64748b]"><tr>{['Buyer','Listing','Spot','Amount','Submitted','Status','Action'].map(x=><th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{data.attention.map(item=><tr key={item.spotId} className="border-b border-[#e7e5e0] last:border-0">
                    <td className="px-4 py-4 font-mono text-xs">{item.buyer}</td><td className="px-4 py-4 font-medium">{item.listingTitle}</td><td className="px-4 py-4 text-[#64748b]">{item.spotLabel}</td><td className="px-4 py-4 font-mono text-xs">{money(item.amount,item.currency)}</td><td className="px-4 py-4 text-[#64748b]">{relative(item.submittedAt)}</td>
                    <td className="px-4 py-4"><span className={item.status==='pending'?'text-amber-700':item.status==='disputed'?'text-[#dc2626]':'text-emerald-700'}>{item.status==='pending'?'Pending':item.status==='disputed'?'Disputed':item.status==='delivered'?'Delivered':'Approved'}</span>{item.status==='approved'&&item.artworkReceived&&<span className="mt-1 block text-[11px] font-normal text-[#16a34a]">Artwork in ✓</span>}{item.status==='delivered'&&<span className="mt-1 block text-[11px] font-normal text-[#64748b]">Needs proof</span>}{item.status==='disputed'&&<span className="mt-1 block max-w-[240px] text-[11px] font-normal text-[#64748b]">{item.disputeReason || 'No reason given'} — resolve with the buyer, they can withdraw</span>}</td>
                    <td className="px-4 py-4"><div className="flex gap-2">{item.status==='pending'?<><button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'approve')} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'reject')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">Reject</button></>:item.status==='delivered'?<Link href={`/listings/${item.listingSlug}`} className="inline-flex rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white">Upload proof</Link>:item.status==='disputed'?<Link href={`/listings/${item.listingSlug}`} className="inline-flex rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold hover:border-[#4166fb]">View</Link>:<button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'fulfill')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">Mark fulfilled</button>}</div></td>
                  </tr>)}</tbody></table>
                {data.attention.length===0 && <Empty text="Nothing needs your attention."/>}
              </div>
            </section>
            {termsFor && (
              <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/50 p-6" onClick={() => { if (busy !== termsFor) setTermsFor(null) }}>
                <div className="max-h-[85vh] w-full max-w-[520px] overflow-y-auto rounded-2xl bg-white p-8 shadow-[0_24px_64px_rgba(2,8,23,0.28)]" onClick={(e) => e.stopPropagation()}>
                  <h2 id="terms-title" className="mb-1 text-[22px]">Seller terms{terms && ` (${terms.version})`}</h2>
                  <p className="mb-4 text-[14px] text-[#64748b]">Your space was approved. Accept the terms to put it live.</p>
                  <pre className="mb-6 whitespace-pre-wrap rounded-xl bg-[#f6f6f4] p-4 font-sans text-[13px] leading-relaxed text-[#020817]/80">{terms ? terms.text : 'Loading terms…'}</pre>
                  {termsError && <p role="alert" className="mb-4 text-sm text-[#dc2626]">{termsError}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <button type="button" onClick={() => setTermsFor(null)} disabled={busy === termsFor} className="text-[14px] font-medium text-[#020817] transition hover:text-[#64748b] disabled:opacity-60">Not yet</button>
                    <button type="button" onClick={() => void accept()} disabled={!terms || busy === termsFor} className="inline-flex items-center whitespace-nowrap rounded-full bg-[#4166fb] px-6 py-[10px] text-[14px] font-medium text-white shadow-sm transition hover:bg-[#3558e8] disabled:opacity-60">{busy === termsFor ? 'Accepting…' : 'Accept & go live'}</button>
                  </div>
                </div>
              </div>
            )}
            {withdrawOpen && (
              <div role="dialog" aria-modal="true" aria-labelledby="withdraw-title" className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/50 p-6">
                <div className="w-full max-w-[480px] rounded-2xl bg-white p-7 shadow-[0_24px_64px_rgba(2,8,23,0.28)]">
                  <h2 id="withdraw-title" className="text-[24px]">Withdraw USDC</h2>
                  <p className="mt-1 text-sm text-[#64748b]">Transfer devnet USDC from your Privy embedded wallet.</p>
                  <div className="mt-4 flex items-center justify-between rounded-xl border border-[#e7e5e0] bg-[#f8fafc] px-4 py-3">
                    <div><p className="text-sm font-medium">Two-factor authentication</p><p className="mt-0.5 text-xs text-[#64748b]">Required for every withdrawal</p></div>
                    {mfaMethods.length > 0 ? <span className="text-sm font-semibold text-emerald-700">Enabled</span> : <button type="button" onClick={showMfaEnrollmentModal} className="rounded-md bg-[#020817] px-3 py-2 text-xs font-semibold text-white">Set up</button>}
                  </div>
                  <label className="mt-5 block text-sm font-medium">Destination Solana address<input value={withdrawAddress} onChange={(event) => setWithdrawAddress(event.target.value)} spellCheck={false} className="mt-2 block w-full rounded-xl border border-[#e7e5e0] px-4 py-3 font-mono text-sm outline-none focus:border-[#4166fb]"/></label>
                  <label className="mt-4 block text-sm font-medium">Amount <span className="font-normal text-[#64748b]">{walletUsdc !== undefined && `(available $${walletUsdc.toFixed(2)})`}</span><input value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} inputMode="decimal" placeholder="0.00" className="mt-2 block w-full rounded-xl border border-[#e7e5e0] px-4 py-3 font-mono text-sm outline-none focus:border-[#4166fb]"/></label>
                  {withdrawError && <p role="alert" className="mt-4 text-sm text-[#dc2626]">{withdrawError}</p>}
                  {withdrawSignature && <a href={`https://explorer.solana.com/tx/${withdrawSignature}?cluster=${encodeURIComponent(process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet')}`} target="_blank" rel="noopener" className="mt-4 block break-all text-sm font-medium text-[#4166fb] underline">Withdrawal confirmed: {withdrawSignature}</a>}
                  {withdrawals.length > 0 && <div className="mt-5 border-t border-[#e7e5e0] pt-4"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-[#64748b]">Recent withdrawals</p><div className="max-h-36 space-y-2 overflow-y-auto">{withdrawals.slice(0, 5).map((item) => <div key={item.id} className="flex items-center justify-between gap-3 text-xs"><span className="truncate font-mono">{item.destination}</span><span className="shrink-0 font-mono">${item.amount.toFixed(2)}</span>{item.status === 'pending' && item.signature ? <button type="button" onClick={() => void confirmWalletWithdrawal(item.id, item.signature!).then((confirmed) => setWithdrawals((current) => current.map((entry) => entry.id === confirmed.id ? confirmed : entry))).catch((error) => setWithdrawError(error instanceof Error ? error.message : 'Still pending'))} className="shrink-0 font-semibold text-[#4166fb]">Retry</button> : <span className={item.status === 'confirmed' ? 'shrink-0 text-emerald-700' : item.status === 'failed' ? 'shrink-0 text-[#dc2626]' : 'shrink-0 text-amber-700'}>{item.status}</span>}</div>)}</div></div>}
                  <div className="mt-6 flex justify-end gap-3">
                    <button type="button" onClick={() => setWithdrawOpen(false)} disabled={withdrawing} className="rounded-md border border-[#d8d6d0] px-5 py-2.5 text-sm font-semibold disabled:opacity-50">Close</button>
                    <button type="button" onClick={() => void withdraw()} disabled={withdrawing || !withdrawAddress.trim() || !withdrawAmount.trim()} className="rounded-md bg-[#4166fb] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{withdrawing ? 'Withdrawing…' : 'Withdraw'}</button>
                  </div>
                </div>
              </div>
            )}
          </>}
        </>
      )}
    </main><Footer />
  </>
}

function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div className="flex items-center gap-4 border-b border-[#e7e5e0] px-6 py-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"><span className="text-[#405072] [&>svg]:h-6 [&>svg]:w-6 [&>svg]:stroke-[1.6]">{icon}</span><div><div className="text-xs text-[#64748b]">{label}</div><div className="mt-0.5 font-[family-name:var(--font-display)] text-2xl">{value}</div></div></div>}
function Empty({text,action,href}:{text:string;action?:string;href?:string}){return <div className="px-6 py-12 text-center text-sm text-[#64748b]">{text}{action&&href&&<Link href={href} className="ml-2 font-semibold text-[#4166fb]">{action}</Link>}</div>}
function DashboardSkeleton(){return <div className="animate-pulse space-y-7 py-6"><div className="h-20 w-2/5 bg-[#eeede8]"/><div className="h-24 border border-[#e7e5e0] bg-white"/><div className="h-72 border border-[#e7e5e0] bg-white"/></div>}
