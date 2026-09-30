'use client'

import Link from 'next/link'
import {
  ArrowRight,
  Check,
  Clock,
  Globe,
  ShieldCheck,
  Sparkles,
  Target,
  Users,
  Wallet,
  Zap,
} from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import ListingCard from '@/components/ListingCard'
import { isEnded, listingUrl } from '@/lib/listings'
import { useStore } from '@/components/StoreProvider'

const steps = [
  {
    icon: Sparkles,
    title: 'List your surface',
    text: 'Suitcase, bike, laptop, body, physical or digital — split into spots with prices.',
    checks: ['Fixed price or auction', 'Every price above zero', 'Deadline in the future'],
  },
  {
    icon: Target,
    title: 'Buyers claim or bid',
    text: 'Fixed spots get claimed. Auction spots get bid up. X login required.',
    checks: ['Claim fixed, bid auctions only', 'Taken spots return 409', 'Min increment or double-up'],
  },
  {
    icon: Zap,
    title: 'You approve',
    text: 'Approve, reject, or mark fulfilled from your dashboard. Payouts settle in devnet USDC.',
    checks: ['Approve / reject / fulfill', 'Records stay in Postgres', 'Devnet USDC payouts'],
  },
]

const faqs = [
  {
    q: 'Do I need an account to browse?',
    a: 'No to browse. Yes with X to list, claim, or bid — seller and buyer come from the session, never a typed name.',
  },
  {
    q: 'Is real money involved?',
    a: 'Devnet only. Claims and bids move devnet USDC through the on-chain program — no mainnet funds, no card.',
  },
  {
    q: 'What surfaces can I list?',
    a: 'Gear, body, physical, digital, reach. Suitcase, bike, laptop, tattoos — if people see it, list it.',
  },
  {
    q: 'How do auctions work?',
    a: 'First bid at or above the price. Later bids beat it by the min increment — or double it when double-up is on.',
  },
]

export default function Home() {
  const { listings } = useStore()
  const live = listings.filter((l) => l.status === 'active' && !isEnded(l.endsAt) && l.spots.some((s) => !s.claimedBy))
  const openSpots = live.reduce((a, l) => a + l.spots.filter((s) => !s.claimedBy).length, 0)

  return (
    <>
      <Header />
      <main>
        {/* Hero */}
        <section className="relative overflow-hidden text-white" style={{ background: 'radial-gradient(circle at 18% 20%, rgba(245,138,231,0.72), transparent 34%), radial-gradient(circle at 84% 20%, rgba(39,135,255,0.82), transparent 42%), linear-gradient(145deg, #124765 0%, #061a38 45%, #070a20 100%)' }}>
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage: 'linear-gradient(rgba(199,199,199,0.45) 1px, transparent 1px), linear-gradient(90deg, rgba(199,199,199,0.45) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse at 50% 0%, #000 0%, transparent 70%)',
              WebkitMaskImage: 'radial-gradient(ellipse at 50% 0%, #000 0%, transparent 70%)',
            }}
          />
          <div className="relative mx-auto flex w-full max-w-[1340px] flex-col items-center px-6 pb-16 pt-20 text-center">
            <span className="animate-fade-up mb-8 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-[14px] py-[6px] font-mono text-xs tracking-wide text-slate-200 backdrop-blur">
              <span className="rounded-full bg-[#28e7b5] px-2 py-[2px] font-semibold text-[#061a38]">Devnet</span>
              Devnet USDC · no card
              <ArrowRight size={13} className="opacity-70" />
            </span>
            <h1 className="animate-fade-up max-w-[16ch] text-white" style={{ animationDelay: '60ms', fontSize: 'clamp(44px, 7vw, 84px)' }}>
              Suitcases, bikes, laptops, bodies — <em className="italic text-[#28e7b5]">sell the space</em>.
            </h1>
            <p className="animate-fade-up mt-6 max-w-[48ch] text-lg text-slate-300" style={{ animationDelay: '120ms' }}>
              List spots at a price or as an auction. Buyers claim with X login. You approve. Devnet USDC only.
            </p>
            <div className="animate-fade-up mt-8 flex flex-wrap justify-center gap-3" style={{ animationDelay: '180ms' }}>
              <Link href="/browse" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-[#e7e5e0] bg-white px-7 py-[15px] text-[16px] font-medium text-[#020817] transition hover:-translate-y-px hover:bg-[#f1f0ec]">
                Browse listings <ArrowRight size={18} />
              </Link>
              <Link href="/list" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-7 py-[15px] text-[16px] font-medium text-white transition hover:-translate-y-px hover:border-white/40 hover:bg-white/[0.14]">
                List your space
              </Link>
            </div>
            <p className="animate-fade-up mt-5 font-mono text-xs tracking-wide text-slate-400" style={{ animationDelay: '220ms' }}>
              X login to list · fixed or auction · seller approves
            </p>
            <div className="animate-fade-up mt-16 w-full max-w-[960px] overflow-hidden rounded-3xl border border-white/15 bg-[#111b34] shadow-[0_40px_80px_rgba(0,0,0,0.45)]" style={{ animationDelay: '260ms' }}>
              <img
                src="https://images.pexels.com/photos/1827234/pexels-photo-1827234.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
                alt="A marketplace of live ad spaces"
                className="h-auto w-full"
              />
            </div>
          </div>
        </section>

        {/* Stats strip */}
        <div className="border-b border-[#e7e5e0] bg-[#fafaf7]">
          <div className="mx-auto flex w-full max-w-[1340px] flex-wrap items-center gap-8 px-6 py-5">
            <span className="text-sm font-medium text-[#64748b]">Fixed price or auction. Session-owned, always.</span>
            <div className="ml-auto flex flex-wrap gap-8">
              <span className="flex items-center gap-2 text-sm font-medium">
                <Users size={15} className="text-[#16a34a]" /> {live.length} live listings
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Check size={15} className="text-[#16a34a]" /> {openSpots} open spots
              </span>
              <span className="flex items-center gap-2 text-sm font-medium">
                <Clock size={15} className="text-[#16a34a]" /> Seller approves every claim
              </span>
            </div>
          </div>
        </div>

        {/* How it works */}
        <section id="how" className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 max-w-[640px]">
              <span className="mb-4 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">How it works</span>
              <h2 className="mb-4" style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>List it, sell it, approve it.</h2>
              <p className="text-[17px] text-[#64748b]">Seller comes from your X session — never a typed name.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {steps.map((s) => (
                <div className="flex flex-col gap-4 rounded-2xl border border-[#e7e5e0] bg-white p-8" key={s.title}>
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e9edfe] text-[#4166fb]">
                    <s.icon size={20} />
                  </span>
                  <h3 className="text-xl">{s.title}</h3>
                  <p className="text-[15px] text-[#64748b]">{s.text}</p>
                  {s.checks.map((c) => (
                    <div className="flex items-start gap-2 text-sm text-[#64748b]" key={c}>
                      <Check size={15} className="mt-[2px] shrink-0 text-[#16a34a]" /> {c}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Live listings */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-[640px]">
                <span className="mb-4 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">Live now</span>
                <h2 className="mb-4" style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>Spaces you can claim today.</h2>
                <p className="text-[17px] text-[#64748b]">Suitcases, kits, lids, tattoos. Pick a spot — X login to claim or bid.</p>
              </div>
              <Link href="/browse" className="mb-2 inline-flex items-center gap-2 rounded-full border border-[#e7e5e0] px-[22px] py-[13px] text-[15px] font-medium transition hover:border-[#64748b] hover:bg-[#f1f0ec]">
                Browse all <ArrowRight size={16} />
              </Link>
            </div>
            {listings.length === 0 ? (
              <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
                <h3 className="text-xl">No live spaces yet.</h3>
                <p className="mt-2 text-sm text-[#64748b]">Be the first creator to list a surface.</p>
                <Link href="/list" className="mt-6 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#0f1a33]">
                  List your space
                </Link>
              </div>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {listings.slice(0, 3).map((listing) => (
                  <Link key={listing.id} href={listingUrl(listing, listings)} className="block">
                    <ListingCard listing={listing} />
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Devnet money, real approvals — replaces the duplicate getting-started + fake stats band. */}
        {/* You stay in control */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 max-w-[640px]">
              <span className="mb-4 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">Devnet truth</span>
              <h2 className="mb-4" style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>Devnet money. Real approvals.</h2>
              <p className="text-[17px] text-[#64748b]">Claims and bids settle in devnet USDC through the on-chain program. Approvals are real and seller-owned.</p>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              <div className="flex flex-col gap-4 rounded-2xl border border-[#e7e5e0] bg-white p-8">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e9edfe] text-[#4166fb]">
                  <ShieldCheck size={20} />
                </span>
                <h3 className="text-xl">Approve, reject, fulfill</h3>
                <p className="text-[15px] text-[#64748b]">From your dashboard. Compared by user ID, not handle.</p>
              </div>
              <div className="flex flex-col gap-4 rounded-2xl border border-[#e7e5e0] bg-white p-8">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e9edfe] text-[#4166fb]">
                  <Globe size={20} />
                </span>
                <h3 className="text-xl">No escrow yet</h3>
                <p className="text-[15px] text-[#64748b]">Adspaces takes no custody. Payouts settle in devnet USDC on Solana.</p>
              </div>
              <div className="flex flex-col gap-4 rounded-2xl border border-[#e7e5e0] bg-white p-8">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[#e9edfe] text-[#4166fb]">
                  <Wallet size={20} />
                </span>
                <h3 className="text-xl">Receipts in Postgres</h3>
                <p className="text-[15px] text-[#64748b]">Listings, spots, claims, bids survive restarts.</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-y border-[#e7e5e0] bg-white py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 max-w-[640px]">
              <span className="mb-4 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">FAQ</span>
              <h2 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }}>Frequently asked questions.</h2>
            </div>
            <div className="grid gap-6 md:grid-cols-2">
              {faqs.map((f) => (
                <div className="flex gap-5 rounded-2xl border border-[#e7e5e0] bg-white p-6" key={f.q}>
                  <div>
                    <h3 className="mb-2 text-lg">{f.q}</h3>
                    <p className="text-sm text-[#64748b]">{f.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="relative flex flex-col items-center gap-4 overflow-hidden rounded-[32px] bg-[#020817] px-8 py-16 text-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0"
                style={{ background: 'radial-gradient(circle at 20% 0%, rgba(245,138,231,0.3), transparent 40%), radial-gradient(circle at 80% 0%, rgba(39,135,255,0.35), transparent 45%)' }}
              />
              <h2 className="relative text-white" style={{ fontSize: 'clamp(28px, 4vw, 44px)' }}>Got a suitcase, bike, laptop, or body?</h2>
              <p className="relative text-[17px] text-slate-300">List spots in under a minute. Devnet publishing, no mainnet charge.</p>
              <div className="relative mt-4 flex flex-wrap justify-center gap-3">
                <Link href="/browse" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/25 bg-white/10 px-7 py-[15px] text-[16px] font-medium text-white transition hover:-translate-y-px hover:bg-white/[0.14]">
                  Browse live spaces
                </Link>
                <Link href="/list" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-7 py-[15px] text-[16px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#3558e8]">
                  List your space <ArrowRight size={18} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  )
}
