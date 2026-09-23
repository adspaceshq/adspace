'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CircleDollarSign, Clock3, LayoutGrid, Plus, Rows3 } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { approveApiSpot, fetchSellerDashboard, fulfillApiSpot, rejectApiSpot } from '@/lib/auth-api'
import { cardPhoto } from '@/lib/listings'
import type { SellerDashboard } from '@/lib/types'

const money = (amount: number, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount)
const relative = (iso: string) => {
  const hours = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000))
  if (hours < 1) return 'Just now'
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export default function DashboardPage() {
  const auth = useAuthSession()
  const [data, setData] = useState<SellerDashboard | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()

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
            <div><h1 className="text-[clamp(38px,5vw,58px)]">Seller dashboard</h1><p className="mt-1 text-[16px] text-[#64748b]">Manage your spaces, buyers, and fulfillment.</p></div>
            <Link href="/list" className="inline-flex w-fit items-center gap-2 rounded-md bg-[#4166fb] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#3154e8]"><Plus size={17}/>List a new space</Link>
          </div>
          {error && <div role="alert" className="mb-5 border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
          {!data ? <DashboardSkeleton /> : <>
            <section aria-label="Seller summary" className="mb-9 grid border border-[#e7e5e0] bg-white sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<LayoutGrid/>} label="Active listings" value={String(data.summary.activeListings)}/>
              <Metric icon={<Rows3/>} label="Open spots" value={String(data.summary.openSpots)}/>
              <Metric icon={<Clock3/>} label="Pending approval" value={String(data.summary.pendingApproval)}/>
              <Metric icon={<CircleDollarSign/>} label="Revenue" value={money(data.summary.revenue, data.summary.currency)}/>
            </section>

            <section className="mb-10">
              <div className="mb-3 flex items-end justify-between"><h2 className="text-[28px]">Your listings</h2><Link href="/browse" className="flex items-center gap-1 text-sm font-medium text-[#4166fb]">View marketplace <ArrowRight size={15}/></Link></div>
              <div className="overflow-x-auto border border-[#e7e5e0] bg-white">
                <table className="w-full min-w-[820px] border-collapse text-left text-sm">
                  <thead className="text-[12px] font-medium text-[#64748b]"><tr>{['Listing','Status','Spots sold / open','Pricing mode','Revenue','Action'].map(x=><th key={x} className="border-b border-[#e7e5e0] px-4 py-3 font-medium">{x}</th>)}</tr></thead>
                  <tbody>{data.listings.map(l=><tr key={l.id} className="border-b border-[#e7e5e0] last:border-0">
                    <td className="px-4 py-4"><div className="flex items-center gap-3"><div className="h-11 w-16 overflow-hidden bg-[#f1f0ec]">{cardPhoto(l) && <img src={cardPhoto(l)} alt="" className="h-full w-full object-cover"/>}</div><span className="font-medium">{l.title}</span></div></td>
                    <td className="px-4 py-4"><span className={`inline-flex items-center gap-2 text-xs font-medium ${l.status==='active'?'text-emerald-700':'text-[#64748b]'}`}><span className={`h-1.5 w-1.5 rounded-full ${l.status==='active'?'bg-emerald-500':'bg-slate-400'}`}/>{l.status==='active'?'Active':'Closed'}</span></td>
                    <td className="px-4 py-4 font-mono text-xs">{l.sold} / {l.open}</td><td className="px-4 py-4 capitalize">{l.mode==='fixed'?'Fixed price':'Auction'}</td><td className="px-4 py-4 font-mono text-xs">{money(l.revenue,l.currency)}</td>
                    <td className="px-4 py-4"><Link href={`/listings/${l.slug}`} className="inline-flex rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold hover:border-[#4166fb]">View</Link></td>
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
                    <td className="px-4 py-4"><span className={item.status==='pending'?'text-amber-700':'text-emerald-700'}>{item.status==='pending'?'Pending':'Approved'}</span></td>
                    <td className="px-4 py-4"><div className="flex gap-2">{item.status==='pending'?<><button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'approve')} className="rounded-md bg-[#4166fb] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Approve</button><button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'reject')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">Reject</button></>:<button disabled={busy===item.spotId} onClick={()=>void act(item.spotId,'fulfill')} className="rounded-md border border-[#d8d6d0] px-4 py-2 text-xs font-semibold disabled:opacity-50">Mark fulfilled</button>}</div></td>
                  </tr>)}</tbody></table>
                {data.attention.length===0 && <Empty text="Nothing needs your attention."/>}
              </div>
            </section>
          </>}
        </>
      )}
    </main><Footer />
  </>
}

function Metric({icon,label,value}:{icon:React.ReactNode;label:string;value:string}){return <div className="flex items-center gap-4 border-b border-[#e7e5e0] px-6 py-5 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0"><span className="text-[#405072] [&>svg]:h-6 [&>svg]:w-6 [&>svg]:stroke-[1.6]">{icon}</span><div><div className="text-xs text-[#64748b]">{label}</div><div className="mt-0.5 font-[family-name:var(--font-display)] text-2xl">{value}</div></div></div>}
function Empty({text,action,href}:{text:string;action?:string;href?:string}){return <div className="px-6 py-12 text-center text-sm text-[#64748b]">{text}{action&&href&&<Link href={href} className="ml-2 font-semibold text-[#4166fb]">{action}</Link>}</div>}
function DashboardSkeleton(){return <div className="animate-pulse space-y-7 py-6"><div className="h-20 w-2/5 bg-[#eeede8]"/><div className="h-24 border border-[#e7e5e0] bg-white"/><div className="h-72 border border-[#e7e5e0] bg-white"/></div>}
