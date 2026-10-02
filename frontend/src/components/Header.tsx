'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronDown, Menu, Search, X } from 'lucide-react'
import Logo from '@/components/Logo'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { PRIVY_ENABLED } from '@/lib/privy'
import { sellerUrl, surfaceLabels } from '@/lib/listings'

const surfaces = Object.entries(surfaceLabels)

export default function Header() {
  const router = useRouter()
  const auth = useAuthSession()
  const [exploreOpen, setExploreOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [search, setSearch] = useState('')

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = search.trim()
    router.push(q ? `/browse?q=${encodeURIComponent(q)}` : '/browse')
    setMenuOpen(false)
  }

  const loggedIn = PRIVY_ENABLED && auth.authenticated

  return (
    <header className="relative bg-[#f4f4f4]">
      <div className="mx-auto flex h-[72px] max-w-[1400px] items-center gap-5 px-4 sm:px-6">
        <Link href="/" aria-label="Adspaces home" className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2">
          <Logo size={34} label="" />
        </Link>

        <nav className="hidden items-center gap-6 text-[15px] font-medium text-[#020817] lg:flex" aria-label="Main">
          <div
            className="relative"
            onMouseEnter={() => setExploreOpen(true)}
            onMouseLeave={() => setExploreOpen(false)}
          >
            <button
              type="button"
              aria-expanded={exploreOpen}
              aria-haspopup="true"
              onClick={() => setExploreOpen((v) => !v)}
              onKeyDown={(e) => { if (e.key === 'Escape') setExploreOpen(false) }}
              className="flex min-h-[40px] items-center gap-1 rounded transition-colors hover:text-[#4166fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
            >
              Explore
              <ChevronDown size={15} className={`transition-transform ${exploreOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {exploreOpen && (
              <div className="absolute left-0 top-full w-60 pt-2">
                <div className="overflow-hidden rounded-xl border border-[#e7e5e0] bg-white py-2 shadow-[0_16px_40px_rgba(2,8,23,0.12)]">
                  <Link
                    href="/browse"
                    onClick={() => setExploreOpen(false)}
                    className="block px-4 py-2.5 text-[14px] font-semibold text-[#020817] transition-colors hover:bg-[#fafaf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4166fb]"
                  >
                    Browse all spaces
                  </Link>
                  <div className="mx-4 my-1 border-t border-[#e7e5e0]" role="separator" />
                  {surfaces.map(([key, label]) => (
                    <Link
                      key={key}
                      href={`/browse?surface=${encodeURIComponent(key)}`}
                      onClick={() => setExploreOpen(false)}
                      className="block px-4 py-2.5 text-[14px] text-[#020817]/80 transition-colors hover:bg-[#fafaf7] hover:text-[#020817] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4166fb]"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Link href="/browse" className="transition-colors hover:text-[#4166fb]">Browse</Link>
          <Link href="/dashboard" className="transition-colors hover:text-[#4166fb]">Dashboard</Link>
          <Link href="/#how" className="transition-colors hover:text-[#4166fb]">How it works</Link>
        </nav>

        <form role="search" onSubmit={submitSearch} className="hidden min-w-0 flex-1 items-center md:flex">
          <label htmlFor="site-search" className="sr-only">Search ad spaces</label>
          <div className="flex w-full max-w-xl items-center gap-2 rounded-xl bg-[#e9e9ea] px-4 transition focus-within:bg-white focus-within:shadow-[0_0_0_2px_#4166fb]">
            <Search size={16} className="shrink-0 text-[#64748b]" aria-hidden="true" />
            <input
              id="site-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by inspiration"
              autoComplete="off"
              className="h-11 w-full bg-transparent text-[14px] text-[#020817] placeholder:text-[#64748b] focus:outline-none"
            />
          </div>
        </form>

        <div className="ml-auto hidden items-center gap-4 lg:flex">
          {loggedIn ? (
            <Link
              href={sellerUrl(auth.handle ?? 'seller')}
              aria-label={`View ${auth.handle ?? 'your'} profile`}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
            >
              {auth.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={auth.avatar} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover ring-1 ring-black/10 transition hover:ring-2 hover:ring-[#4166fb]" />
              ) : (
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#020817] text-sm font-semibold text-white">
                  {(auth.handle ?? 'A').replace('@', '').charAt(0).toUpperCase()}
                </span>
              )}
            </Link>
          ) : PRIVY_ENABLED && (
            <button
              type="button"
              onClick={auth.login}
              disabled={!auth.ready || auth.loggingIn}
              className="min-h-[40px] rounded text-[15px] font-medium text-[#020817] transition-colors hover:text-[#4166fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2 disabled:opacity-60"
            >
              {auth.loggingIn ? 'Connecting…' : 'Log in'}
            </button>
          )}
          <Link
            href="/list"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-[#020817] px-5 text-[15px] font-medium text-white transition hover:-translate-y-px hover:bg-[#0f1a33] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
          >
            List your space
          </Link>
          <Link
            href="/browse"
            className="inline-flex min-h-[44px] items-center rounded-xl border border-[#020817]/25 px-5 text-[15px] font-medium text-[#020817] transition hover:border-[#020817] hover:bg-[#fafaf7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
          >
            Browse
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
          onKeyDown={(e) => { if (e.key === 'Escape') setMenuOpen(false) }}
          className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#020817] transition hover:bg-[#f1f0ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2 lg:hidden"
        >
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      {menuOpen && (
        <div className="border-t border-black/10 bg-white px-4 pb-6 pt-4 sm:px-6 lg:hidden">
          <form role="search" onSubmit={submitSearch} className="mb-4 md:hidden">
            <label htmlFor="site-search-mobile" className="sr-only">Search ad spaces</label>
            <div className="flex w-full items-center gap-2 rounded-xl bg-[#e9e9ea] px-4 transition focus-within:bg-white focus-within:shadow-[0_0_0_2px_#4166fb]">
              <Search size={16} className="shrink-0 text-[#64748b]" aria-hidden="true" />
              <input
                id="site-search-mobile"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by inspiration"
                autoComplete="off"
                className="h-11 w-full bg-transparent text-[14px] text-[#020817] placeholder:text-[#64748b] focus:outline-none"
              />
            </div>
          </form>
          <nav className="flex flex-col gap-1 text-[15px] font-medium text-[#020817]" aria-label="Mobile">
            {[
              ['Browse all spaces', '/browse'],
              ...surfaces.map(([key, label]) => [`${label} spaces`, `/browse?surface=${encodeURIComponent(key)}`] as [string, string]),
              ['Dashboard', '/dashboard'],
              ['How it works', '/#how'],
            ].map(([label, href]) => (
              <Link
                key={href + label}
                href={href}
                onClick={() => setMenuOpen(false)}
                className="rounded-lg px-2 py-2.5 transition-colors hover:bg-[#f1f0ec] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb]"
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            {!loggedIn && PRIVY_ENABLED && (
              <button
                type="button"
                onClick={() => { auth.login(); }}
                disabled={!auth.ready || auth.loggingIn}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#020817]/25 text-[15px] font-medium text-[#020817] disabled:opacity-60"
              >
                {auth.loggingIn ? 'Connecting…' : 'Log in'}
              </button>
            )}
            <Link
              href="/list"
              onClick={() => setMenuOpen(false)}
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[#020817] text-[15px] font-medium text-white"
            >
              List your space
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}
