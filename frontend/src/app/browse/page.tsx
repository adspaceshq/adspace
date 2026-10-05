'use client'

import { Suspense, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowUpDown,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from 'lucide-react'
import Header from '@/components/Header'
import ListingCard from '@/components/ListingCard'
import { useStore } from '@/components/StoreProvider'
import { isEnded, listingUrl, surfaceLabels, type Listing } from '@/lib/listings'
import { useSurfacePicker } from '@/components/SurfacePickerModal'

type PriceFormatFilter = 'all' | 'auction' | 'fixed'
type SortOption = 'ending-soonest' | 'newest' | 'price-low' | 'price-high' | 'spots-left'

export default function BrowsePage() {
  return (
    <Suspense>
      <BrowseInner />
    </Suspense>
  )
}

function BrowseInner() {
  const { listings } = useStore()
  const { openPicker } = useSurfacePicker()
  const params = useSearchParams()

  const initialSurface = params.get('surface') ?? 'all'
  const [surface, setSurface] = useState(
    initialSurface === 'all' || initialSurface in surfaceLabels ? initialSurface : 'all',
  )
  const [formatFilter, setFormatFilter] = useState<PriceFormatFilter>('all')
  const [sortBy, setSortBy] = useState<SortOption>('ending-soonest')
  const [query, setQuery] = useState('')

  // Total marketplace stats
  const activeListings = useMemo(() => {
    return listings.filter((l) => l.status === 'active' && !isEnded(l.endsAt))
  }, [listings])

  const totalOpenSpots = useMemo(() => {
    return activeListings.reduce((acc, l) => {
      const isAuction = l.priceType === 'auction'
      const open = l.spots.filter((s) => (isAuction ? !s.bidBy : !s.claimedBy)).length
      return acc + open
    }, 0)
  }, [activeListings])

  const auctionCount = useMemo(() => {
    return activeListings.filter((l) => l.priceType === 'auction').length
  }, [activeListings])

  // Count by surface
  const surfaceCounts = useMemo(() => {
    const counts: Record<string, number> = { all: activeListings.length }
    for (const key of Object.keys(surfaceLabels)) {
      counts[key] = activeListings.filter((l) => l.surface === key).length
    }
    return counts
  }, [activeListings])

  // Filter and sort listings
  const filtered = useMemo(() => {
    const search = query.trim().toLowerCase()
    const result = activeListings.filter((l) => {
      if (surface !== 'all' && l.surface !== surface) return false
      if (formatFilter === 'auction' && l.priceType !== 'auction') return false
      if (formatFilter === 'fixed' && l.priceType === 'auction') return false
      if (search) {
        const haystack = [
          l.title,
          l.description,
          l.goal,
          l.seller.name,
          l.seller.handle,
          surfaceLabels[l.surface] ?? l.surface,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    return result.sort((a, b) => {
      const aMin = Math.min(...a.spots.map((s) => s.price))
      const bMin = Math.min(...b.spots.map((s) => s.price))
      const aOpen = a.spots.filter((s) => (a.priceType === 'auction' ? !s.bidBy : !s.claimedBy)).length
      const bOpen = b.spots.filter((s) => (b.priceType === 'auction' ? !s.bidBy : !s.claimedBy)).length

      if (sortBy === 'price-low') return aMin - bMin
      if (sortBy === 'price-high') return bMin - aMin
      if (sortBy === 'spots-left') return bOpen - aOpen
      if (sortBy === 'newest') {
        const aDate = new Date(a.endsAt ?? 0).getTime()
        const bDate = new Date(b.endsAt ?? 0).getTime()
        return bDate - aDate
      }
      const aEnds = new Date(a.endsAt ?? 0).getTime()
      const bEnds = new Date(b.endsAt ?? 0).getTime()
      return aEnds - bEnds
    })
  }, [activeListings, surface, formatFilter, query, sortBy])

  const hasActiveFilters = surface !== 'all' || formatFilter !== 'all' || query.trim().length > 0

  const resetFilters = () => {
    setSurface('all')
    setFormatFilter('all')
    setQuery('')
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f4f4]">
      <Header />

      <main className="mx-auto w-full max-w-[1340px] flex-1 px-6 pb-16 pt-5 md:pt-6">
        {/* Top Header — Clean, Unboxed (exact Dashboard style) */}
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl sm:text-[26px] font-medium tracking-tight text-[#020817]">
                Marketplace
              </h1>
              <span className="hidden items-center gap-1.5 rounded-full bg-[#ecebe6] px-3 py-0.5 text-[12px] font-mono font-normal text-[#020817] sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                {activeListings.length} live spaces
              </span>
            </div>
            <p className="mt-1 text-[13px] text-[#64748b]">
              Every physical surface with open sponsor spots.
            </p>
          </div>

          <button
            type="button"
            onClick={openPicker}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#020817] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#1a2436] active:scale-[0.98] cursor-pointer"
          >
            <Plus size={14} />
            <span>List a space</span>
          </button>
        </div>

        {/* Unboxed Stats Strip (mirrors Dashboard MetricItem pattern) */}
        <section aria-label="Marketplace summary" className="mb-6 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4 max-w-2xl">
          <div>
            <span className="text-[11px] font-normal uppercase tracking-wider text-[#64748b]">Live spaces</span>
            <span className="mt-0.5 block text-xl font-medium tracking-tight text-[#020817]">{activeListings.length}</span>
          </div>
          <div>
            <span className="text-[11px] font-normal uppercase tracking-wider text-[#64748b]">Spots open</span>
            <span className="mt-0.5 block text-xl font-medium tracking-tight text-[#020817]">{totalOpenSpots}</span>
          </div>
          <div>
            <span className="text-[11px] font-normal uppercase tracking-wider text-[#64748b]">Auctions</span>
            <span className="mt-0.5 block text-xl font-medium tracking-tight text-[#020817]">{auctionCount}</span>
          </div>
          <div>
            <span className="text-[11px] font-normal uppercase tracking-wider text-[#64748b]">Settlement</span>
            <span className="mt-0.5 block text-xl font-medium tracking-tight text-[#020817]">Devnet USDC</span>
          </div>
        </section>

        <div className="mb-4 max-w-xl">
          <label className="relative block">
            <span className="sr-only">Search marketplace</span>
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#64748b]" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by space, creator, surface, or city"
              className="h-11 w-full rounded-full border border-[#d8d6d0] bg-white pl-9 pr-4 text-[13px] text-[#020817] shadow-2xs outline-none transition placeholder:text-[#94a3b8] focus:border-[#4166fb] focus:ring-2 focus:ring-[#4166fb]/15"
            />
          </label>
        </div>

        {/* Controls: Category Tabs + Format & Sort (Zero lines, clean & unboxed) */}
        <div className="mb-8 flex flex-wrap items-center justify-between gap-y-3">
            {/* Surface Links */}
            <div className="flex items-center gap-2 text-[13px] overflow-x-auto scrollbar-none">
              {['all', ...Object.keys(surfaceLabels)].map((key) => {
                const count = surfaceCounts[key] ?? 0
                const isActive = surface === key
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSurface(key)}
                    className={`whitespace-nowrap px-3 py-1 rounded-full transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-black/5 font-medium text-[#020817]'
                        : 'font-normal text-[#64748b] hover:text-[#020817]'
                    }`}
                  >
                    <span>{key === 'all' ? 'All spaces' : surfaceLabels[key]}</span>
                    <span className="ml-1 text-[11px] text-[#94a3b8]">({count})</span>
                  </button>
                )
              })}
            </div>

            {/* Right: Format + Sort + Reset */}
            <div className="flex items-center gap-3 text-xs ml-auto">
              <div className="flex items-center gap-2 text-[#64748b]">
                <button
                  type="button"
                  onClick={() => setFormatFilter('all')}
                  className={`cursor-pointer transition ${formatFilter === 'all' ? 'font-medium text-[#020817]' : 'hover:text-[#020817]'}`}
                >
                  All
                </button>
                <span className="text-[#cbd5e1]">·</span>
                <button
                  type="button"
                  onClick={() => setFormatFilter('auction')}
                  className={`cursor-pointer transition ${formatFilter === 'auction' ? 'font-medium text-[#020817]' : 'hover:text-[#020817]'}`}
                >
                  Auctions
                </button>
                <span className="text-[#cbd5e1]">·</span>
                <button
                  type="button"
                  onClick={() => setFormatFilter('fixed')}
                  className={`cursor-pointer transition ${formatFilter === 'fixed' ? 'font-medium text-[#020817]' : 'hover:text-[#020817]'}`}
                >
                  Fixed
                </button>
              </div>

              <span className="text-[#e5e4de]">|</span>

              <div className="flex items-center gap-1.5 text-[#64748b]">
                <ArrowUpDown size={12} />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortOption)}
                  className="bg-transparent text-xs text-[#64748b] hover:text-[#020817] cursor-pointer focus:outline-none pr-1"
                >
                  <option value="ending-soonest">Ending soonest</option>
                  <option value="newest">Newest first</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="spots-left">Most spots</option>
                </select>
              </div>

              {hasActiveFilters && (
                <>
                  <span className="text-[#e5e4de]">|</span>
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-700 transition cursor-pointer"
                  >
                    <RotateCcw size={11} />
                    <span>Clear</span>
                  </button>
                </>
              )}
            </div>
          </div>

        {/* Listings Content: Unboxed Empty State or Minimal Cards */}
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-[#ecebe6] text-[#64748b] mb-3">
              <Sparkles size={18} />
            </div>
            <p className="text-[14px] text-[#64748b]">No live spaces match your filters.</p>
            <div className="mt-3.5 flex items-center gap-3">
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="text-xs text-[#4166fb] hover:underline cursor-pointer"
                >
                  Clear search filters
                </button>
              )}
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#020817] px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-[#1a2333] transition cursor-pointer"
              >
                <Plus size={14} />
                <span>List your space</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <AnimatePresence mode="popLayout">
              {filtered.map((listing, i) => (
                <motion.div
                  key={listing.id}
                  layout
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.2) }}
                >
                  <Link href={listingUrl(listing, listings)} className="block h-full">
                    <ListingCard listing={listing} />
                  </Link>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  )
}
