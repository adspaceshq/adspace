'use client'

import { use } from 'react'
import Link from 'next/link'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import ListingCard from '@/components/ListingCard'
import { listingUrl } from '@/lib/listings'
import { useStore } from '@/components/StoreProvider'

const RESERVED = new Set(['browse', 'list', 'listings', 'dashboard', 'api', 'favicon.ico'])

export default function SellerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = use(params)
  const { listings, hydrated } = useStore()

  const clean = decodeURIComponent(raw ?? '').trim().replace(/^@+/, '').toLowerCase()

  if (RESERVED.has(clean)) {
    return (
      <>
        <Header />
        <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
          <h1 className="text-4xl">Space not found.</h1>
          <Link href="/browse" className="mt-2 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white">
            Back to browse
          </Link>
        </main>
        <Footer />
      </>
    )
  }

  const mine = listings.filter((l) => {
    const h = (l.seller.handle ?? '').replace(/^@+/, '').toLowerCase()
    const n = (l.seller.name ?? '').replace(/^@+/, '').toLowerCase()
    return h === clean || n === clean
  })

  const display = mine[0]?.seller.handle || (clean ? `@${clean}` : '@seller')
  const initial = (mine[0]?.seller.name || clean || 'S').charAt(0).toUpperCase()
  const color = mine[0]?.seller.color ?? '#4166fb'

  return (
    <>
      <Header />
      <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">
        <Link href="/browse" className="mb-6 inline-block text-sm font-medium text-[#64748b] transition hover:text-[#020817]">
          ← Back to browse
        </Link>

        <div className="mb-8 flex items-center gap-4">
          <span
            className="grid h-14 w-14 shrink-0 place-items-center rounded-full text-xl font-semibold text-white"
            style={{ background: color }}
          >
            {initial}
          </span>
          <div>
            <h1 className="text-3xl">{display}</h1>
            <p className="text-[15px] text-[#64748b]">
              {!hydrated
                ? 'Loading spaces…'
                : mine.length === 0
                  ? 'No live spaces yet.'
                  : `${mine.length} live space${mine.length === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {!hydrated ? (
          <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center text-sm text-[#64748b]">
            Loading spaces…
          </div>
        ) : mine.length === 0 ? (
          <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
            <h3 className="text-xl">No spaces from {display} yet.</h3>
            <p className="mt-2 text-sm text-[#64748b]">Try another seller — or list your own surface.</p>
            <Link href="/browse" className="mt-6 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#0f1a33]">
              Browse all spaces
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {mine.map((listing) => (
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
