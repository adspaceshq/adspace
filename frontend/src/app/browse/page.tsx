'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import ListingCard from '@/components/ListingCard'
import { useStore } from '@/components/StoreProvider'
import { isEnded, listingUrl, surfaceLabels } from '@/lib/listings'

export default function BrowsePage() {
  const { listings } = useStore()
  const [query, setQuery] = useState('')
  const [surface, setSurface] = useState<string>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return listings.filter((l) => {
      if (l.status !== 'active' || isEnded(l.endsAt)) return false
      if (surface !== 'all' && l.surface !== surface) return false
      if (!q) return true
      return (
        l.title.toLowerCase().includes(q) ||
        l.goal.toLowerCase().includes(q) ||
        l.seller.name.toLowerCase().includes(q)
      )
    })
  }, [listings, query, surface])

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-6">
          <div>
            <span className="mb-3 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">Marketplace</span>
            <h1 style={{ fontSize: 'clamp(30px, 4vw, 44px)' }} className="mb-2">Browse live spaces.</h1>
            <p className="text-[16px] text-[#64748b]">Every surface with an open spot. Claim one and fund what they&apos;re building.</p>
          </div>
        </div>

        <div className="mb-8 flex flex-col gap-4">
          <label className="flex items-center gap-3 rounded-xl border border-[#e7e5e0] bg-white px-4 text-[#64748b] transition focus-within:border-[#4166fb] focus-within:shadow-[0_0_0_3px_#e9edfe]">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search suitcases, bikes, bodies…"
              className="w-full bg-transparent py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {['all', ...Object.keys(surfaceLabels)].map((key) => (
              <button
                key={key}
                onClick={() => setSurface(key)}
                className={`rounded-full border px-4 py-[9px] text-[13px] font-medium transition ${
                  surface === key
                    ? 'border-[#020817] bg-[#020817] text-white'
                    : 'border-[#e7e5e0] bg-white text-[#64748b] hover:border-[#64748b] hover:text-[#020817]'
                }`}
              >
                {key === 'all' ? 'All surfaces' : surfaceLabels[key]}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
            <h3 className="text-xl">No spaces match.</h3>
            <p className="mt-2 text-sm text-[#64748b]">Try a different search — or list your own surface.</p>
            <Link href="/list" className="mt-6 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#0f1a33]">
              List your space
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((listing) => (
              <Link key={listing.id} href={listingUrl(listing, listings)} className="block">
                <ListingCard listing={listing} />
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  )
}
