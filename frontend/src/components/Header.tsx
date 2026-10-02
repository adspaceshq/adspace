'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  Check,
  ChevronDown,
  Copy,
  LogOut,
  Menu,
  User,
  X,
} from 'lucide-react'
import Logo from '@/components/Logo'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { useSurfacePicker } from '@/components/SurfacePickerModal'
import { PRIVY_ENABLED } from '@/lib/privy'
import { sellerUrl, surfaceLabels } from '@/lib/listings'

const surfaces = Object.entries(surfaceLabels)

export default function Header() {
  const router = useRouter()
  const pathname = usePathname()
  const auth = useAuthSession()
  const { openPicker } = useSurfacePicker()
  const [exploreOpen, setExploreOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [copiedWallet, setCopiedWallet] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const copyWallet = () => {
    if (!auth.walletAddress) return
    navigator.clipboard.writeText(auth.walletAddress)
    setCopiedWallet(true)
    setTimeout(() => setCopiedWallet(false), 2000)
  }

  const loggedIn = PRIVY_ENABLED && auth.authenticated
  const cleanHandle = auth.handle ? (auth.handle.startsWith('@') ? auth.handle : `@${auth.handle}`) : null

  return (
    <header className="relative bg-[#f4f4f4] border-b border-[#e9e9e6]">
      <div className="mx-auto flex h-[68px] max-w-[1400px] items-center gap-5 px-4 sm:px-6">
        <Link
          href={loggedIn ? '/dashboard' : '/'}
          aria-label="Adspaces home"
          className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
        >
          <Logo size={32} label="" />
        </Link>

        {loggedIn ? (
          /* AUTHENTICATED NAVIGATION: Clean Typographic (Stripe / Airbnb style) */
          <nav className="hidden items-center gap-6 text-[15px] font-medium lg:flex" aria-label="App">
            <Link
              href="/dashboard"
              className={`transition-colors ${
                pathname === '/dashboard'
                  ? 'font-semibold text-[#020817]'
                  : 'text-[#64748b] hover:text-[#020817]'
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/browse"
              className={`transition-colors ${
                pathname.startsWith('/browse') || pathname.startsWith('/listings')
                  ? 'font-semibold text-[#020817]'
                  : 'text-[#64748b] hover:text-[#020817]'
              }`}
            >
              Marketplace
            </Link>
            {auth.isReviewer && (
              <Link
                href="/review"
                className={`transition-colors ${
                  pathname === '/review'
                    ? 'font-semibold text-[#020817]'
                    : 'text-[#64748b] hover:text-[#020817]'
                }`}
              >
                Review queue
              </Link>
            )}
          </nav>
        ) : (
          /* PUBLIC / GUEST NAVIGATION */
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
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setExploreOpen(false)
                }}
                className="flex min-h-[40px] items-center gap-1 rounded transition-colors hover:text-[#4166fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
              >
                Explore
                <ChevronDown
                  size={15}
                  className={`transition-transform ${exploreOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>
              {exploreOpen && (
                <div className="absolute left-0 top-full w-60 pt-2 z-50">
                  <div className="overflow-hidden rounded-xl border border-[#e7e5e0] bg-white py-2 shadow-[0_16px_40px_rgba(2,8,23,0.12)]">
                    <Link
                      href="/browse"
                      onClick={() => setExploreOpen(false)}
                      className="block px-4 py-2.5 text-[14px] font-semibold text-[#020817] transition-colors hover:bg-[#fafaf7]"
                    >
                      Browse all spaces
                    </Link>
                    <div className="mx-4 my-1 border-t border-[#e7e5e0]" role="separator" />
                    {surfaces.map(([key, label]) => (
                      <Link
                        key={key}
                        href={`/browse?surface=${encodeURIComponent(key)}`}
                        onClick={() => setExploreOpen(false)}
                        className="block px-4 py-2.5 text-[14px] text-[#020817]/80 transition-colors hover:bg-[#fafaf7] hover:text-[#020817]"
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <Link href="/browse" className="transition-colors hover:text-[#4166fb]">
              Browse
            </Link>
            <Link href="/#how" className="transition-colors hover:text-[#4166fb]">
              How it works
            </Link>
          </nav>
        )}

        {/* Right Side Actions */}
        <div className="ml-auto hidden items-center gap-3 lg:flex">
          {loggedIn ? (
            /* AUTHENTICATED ACTIONS: Single List button + User Profile Dropdown */
            <>
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex h-9 items-center rounded-full bg-[#020817] px-4 text-[13px] font-medium text-white transition hover:bg-[#1a2436] active:scale-[0.98] cursor-pointer"
              >
                List your space
              </button>

              {/* User Menu Dropdown */}
              <div className="relative" ref={userMenuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((v) => !v)}
                  className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition hover:bg-black/5 cursor-pointer"
                  aria-expanded={userMenuOpen}
                  aria-haspopup="true"
                >
                  {auth.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={auth.avatar}
                      alt=""
                      className="h-8 w-8 rounded-full object-cover ring-1 ring-black/10"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-[#020817] text-xs font-semibold text-white">
                      {(auth.handle ?? 'U').replace('@', '').charAt(0).toUpperCase()}
                    </span>
                  )}
                  {cleanHandle && (
                    <span className="text-[13px] font-medium text-[#020817]">{cleanHandle}</span>
                  )}
                  <ChevronDown
                    size={14}
                    className={`text-[#64748b] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl border border-[#ecebe6] bg-white p-2 shadow-xl z-50">
                    <div className="px-3 py-2 border-b border-[#ecebe6]/60">
                      <p className="text-[14px] font-medium text-[#020817] truncate">
                        {auth.name ?? cleanHandle}
                      </p>
                      {cleanHandle && (
                        <p className="text-[12px] text-[#64748b] truncate">{cleanHandle}</p>
                      )}
                      {auth.walletAddress && (
                        <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-[#64748b]">
                          <span>{auth.walletAddress.slice(0, 6)}...{auth.walletAddress.slice(-4)}</span>
                          <button
                            type="button"
                            onClick={copyWallet}
                            className="inline-flex items-center gap-1 hover:text-[#020817] transition cursor-pointer"
                          >
                            {copiedWallet ? <Check size={11} className="text-emerald-600" /> : <Copy size={11} />}
                            <span>{copiedWallet ? 'Copied' : 'Copy'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="py-1">
                      <Link
                        href={sellerUrl(auth.handle ?? 'seller')}
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-[#020817] transition hover:bg-[#fafaf7]"
                      >
                        <User size={15} className="text-[#64748b]" />
                        <span>Public profile</span>
                      </Link>
                      <Link
                        href="/dashboard"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-[#020817] transition hover:bg-[#fafaf7]"
                      >
                        <span className="text-[13px] pl-5">Dashboard & payouts</span>
                      </Link>
                    </div>

                    <div className="border-t border-[#ecebe6]/60 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false)
                          void auth.logout()
                        }}
                        className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-[13px] text-red-600 transition hover:bg-red-50 cursor-pointer"
                      >
                        <LogOut size={15} />
                        <span>Sign out</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            /* GUEST ACTIONS */
            <>
              {PRIVY_ENABLED && (
                <button
                  type="button"
                  onClick={auth.login}
                  disabled={!auth.ready || auth.loggingIn}
                  className="min-h-[40px] rounded text-[15px] font-medium text-[#020817] transition-colors hover:text-[#4166fb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2 disabled:opacity-60 cursor-pointer"
                >
                  {auth.loggingIn ? 'Connecting…' : 'Log in'}
                </button>
              )}
              <button
                type="button"
                onClick={openPicker}
                className="inline-flex min-h-[42px] items-center rounded-full bg-[#020817] px-5 text-[14px] font-medium text-white transition hover:bg-[#1a2436] cursor-pointer"
              >
                List your space
              </button>
              <Link
                href="/browse"
                className="inline-flex min-h-[42px] items-center rounded-full border border-[#020817]/25 px-5 text-[14px] font-medium text-[#020817] transition hover:border-[#020817] hover:bg-[#fafaf7]"
              >
                Browse
              </Link>
            </>
          )}
        </div>

        {/* Mobile Menu Hamburger */}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((v) => !v)}
          className="ml-auto grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[#020817] transition hover:bg-[#f1f0ec] lg:hidden"
        >
          {menuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        </button>
      </div>

      {/* Mobile Drawer */}
      {menuOpen && (
        <div className="border-t border-black/10 bg-white px-4 pb-6 pt-4 sm:px-6 lg:hidden">
          <nav className="flex flex-col gap-1 text-[15px] font-medium text-[#020817]">
            {loggedIn ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                >
                  Dashboard
                </Link>
                <Link
                  href="/browse"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                >
                  Marketplace
                </Link>
                <Link
                  href={sellerUrl(auth.handle ?? 'seller')}
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                >
                  My Profile ({cleanHandle})
                </Link>
                {auth.isReviewer && (
                  <Link
                    href="/review"
                    onClick={() => setMenuOpen(false)}
                    className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                  >
                    Review Queue
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false)
                    void auth.logout()
                  }}
                  className="rounded-lg px-2 py-2 text-left text-red-600 hover:bg-red-50 cursor-pointer"
                >
                  Sign out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/browse"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                >
                  Browse all spaces
                </Link>
                <Link
                  href="/#how"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-lg px-2 py-2 hover:bg-[#f1f0ec]"
                >
                  How it works
                </Link>
              </>
            )}
          </nav>
          <div className="mt-4 flex flex-col gap-2">
            {!loggedIn && PRIVY_ENABLED && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false)
                  auth.login()
                }}
                disabled={!auth.ready || auth.loggingIn}
                className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-[#020817]/25 text-[14px] font-medium text-[#020817]"
              >
                {auth.loggingIn ? 'Connecting…' : 'Log in'}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false)
                openPicker()
              }}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl bg-[#020817] text-[14px] font-medium text-white"
            >
              List your space
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
