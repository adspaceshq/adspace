'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
// Kept for the commented-out blocks below — restore is uncomment-only.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ArrowUpRight, Sparkles, Terminal } from 'lucide-react'

export default function Footer() {
  const footerRef = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState<number>(540)
  const [isFixed, setIsFixed] = useState(false)

  useEffect(() => {
    const updateSize = () => {
      if (footerRef.current) {
        const measured = footerRef.current.offsetHeight
        if (measured > 0) setHeight(measured)
      }
      // On small screens (e.g. landscape phone or very short viewport), keep normal flow
      setIsFixed(window.innerHeight >= 500)
    }

    updateSize()

    let ro: ResizeObserver | null = null
    if (footerRef.current && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => updateSize())
      ro.observe(footerRef.current)
    }

    window.addEventListener('resize', updateSize)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', updateSize)
    }
  }, [])

  return (
    <div
      className="relative w-full"
      style={{
        height: isFixed && height > 0 ? `${height}px` : 'auto',
        clipPath: isFixed ? 'polygon(0% 0, 100% 0%, 100% 100%, 0 100%)' : undefined,
      }}
    >
      <footer
        ref={footerRef}
        className={`${
          isFixed ? 'fixed bottom-0 left-0 right-0 z-0' : 'relative z-0'
        } w-full overflow-hidden bg-[#07070a] text-white selection:bg-[#4166fb] selection:text-white`}
      >
        {/* Technical Blueprint Grid Background */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: `
              linear-gradient(to right, rgba(255, 255, 255, 0.07) 1px, transparent 1px),
              linear-gradient(to bottom, rgba(255, 255, 255, 0.07) 1px, transparent 1px)
            `,
            backgroundSize: '40px 40px',
            maskImage: 'radial-gradient(ellipse 90% 85% at 50% 100%, black 50%, transparent 95%)',
            WebkitMaskImage: 'radial-gradient(ellipse 90% 85% at 50% 100%, black 50%, transparent 95%)',
          }}
        />

        {/* Ambient Top Glow */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-80 w-[700px] rounded-full bg-[#4166fb]/10 blur-[120px]"
        />

        {/* Giant Watermark Typography (as seen in Paper.design) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute bottom-[-16%] left-1/2 -translate-x-1/2 select-none whitespace-nowrap text-center font-black tracking-[-0.06em] text-white/[0.035] leading-none"
          style={{ fontSize: 'clamp(90px, 19vw, 250px)' }}
        >
          adspaces
        </div>

        {/* Footer Inner Content */}
        <div className="relative z-10 mx-auto max-w-[1340px] px-6 pb-12 pt-14 sm:pt-16">
          {/* Top Row: Mini Nav & Action Blocks (Paper.design style) */}
          <div className="mb-12 border-b border-white/[0.08] pb-10">
            <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <Link
                  href="/"
                  className="font-display text-[22px] font-bold tracking-tight text-white transition-opacity hover:opacity-85"
                >
                  adspaces
                </Link>
                {/* FUTURE: version badge — restore when versioning is public.
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                  Devnet v1.0
                </span>
                */}
              </div>

              <div className="flex flex-wrap items-center gap-6 text-[14px] text-white/70">
                <Link href="/browse" className="transition-colors hover:text-white">
                  browse
                </Link>
                <Link href="/sell" className="transition-colors hover:text-white">
                  list a space
                </Link>
                <Link href="/#how" className="transition-colors hover:text-white">
                  how it works
                </Link>
                <Link href="/dashboard" className="transition-colors hover:text-white">
                  dashboard
                </Link>
                <Link href="/terms" className="transition-colors hover:text-white">
                  terms
                </Link>
              </div>
            </div>

            {/* FUTURE: wireframe action boxes — restore when footer CTAs are wanted.
            <div className="grid gap-4 sm:grid-cols-2">
              <Link
                href="/sell"
                className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-[14px] font-medium text-white/85 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <span className="flex items-center gap-2.5">
                  <Sparkles size={16} className="text-[#4166fb]" />
                  <span>Turn your surface into ad inventory</span>
                </span>
                <span className="flex items-center gap-1 text-[13px] text-white/50 transition-colors group-hover:text-white">
                  list now <ArrowUpRight size={14} />
                </span>
              </Link>

              <a
                href="https://explorer.solana.com/?cluster=devnet"
                target="_blank"
                rel="noreferrer"
                className="group flex items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] p-4 text-[14px] font-medium text-white/85 backdrop-blur-sm transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                <span className="flex items-center gap-2.5">
                  <Terminal size={16} className="text-emerald-400" />
                  <span>Settlements powered by Solana Devnet USDC</span>
                </span>
                <span className="flex items-center gap-1 text-[13px] text-white/50 transition-colors group-hover:text-white">
                  view explorer <ArrowUpRight size={14} />
                </span>
              </a>
            </div>
            */}
          </div>

          {/* FUTURE: links grid (Marketplace / Surfaces / Protocol / Community / Legal) —
              restore column by column as those destinations go live.
          <div className="mb-16 grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-5">
            <div>
              <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-white/40">
                Marketplace
              </p>
              <div className="flex flex-col space-y-2.5 text-[14px] text-white/65">
                <Link href="/browse" className="transition-colors hover:text-white">
                  Browse live spaces
                </Link>
                <Link href="/sell" className="transition-colors hover:text-white">
                  List your surface
                </Link>
                <Link href="/#how" className="transition-colors hover:text-white">
                  How it works
                </Link>
                <Link href="/dashboard" className="transition-colors hover:text-white">
                  Creator dashboard
                </Link>
                <Link href="/dashboard" className="transition-colors hover:text-white">
                  Sponsor tracking
                </Link>
              </div>
            </div>

            <div>
              <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-white/40">
                Surfaces
              </p>
              <div className="flex flex-col space-y-2.5 text-[14px] text-white/65">
                <Link href="/browse?surface=gear" className="transition-colors hover:text-white">
                  Laptop lids
                </Link>
                <Link href="/browse?surface=apparel" className="transition-colors hover:text-white">
                  T-Shirts & Apparel
                </Link>
                <Link href="/browse?surface=body" className="transition-colors hover:text-white">
                  Body & Race Tattoos
                </Link>
                <Link href="/browse?surface=physical" className="transition-colors hover:text-white">
                  Suitcases & Travel
                </Link>
                <Link href="/browse?surface=reach" className="transition-colors hover:text-white">
                  Digital & Reach
                </Link>
              </div>
            </div>

            <div>
              <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-white/40">
                Protocol
              </p>
              <div className="flex flex-col space-y-2.5 text-[14px] text-white/65">
                <span className="text-white/80">Devnet USDC Escrow</span>
                <span className="text-white/80">Delegated Privy Wallets</span>
                <Link href="/review" className="transition-colors hover:text-white">
                  Review queue
                </Link>
                <span className="text-white/50 text-[13px]">Double-up auctions</span>
                <span className="text-white/50 text-[13px]">Automated refunds</span>
              </div>
            </div>

            <div>
              <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-white/40">
                Community
              </p>
              <div className="flex flex-col space-y-2.5 text-[14px] text-white/65">
                <a
                  href="https://x.com"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-white"
                >
                  Twitter / X
                </a>
                <a
                  href="https://github.com"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-white"
                >
                  GitHub
                </a>
                <a
                  href="https://discord.com"
                  target="_blank"
                  rel="noreferrer"
                  className="transition-colors hover:text-white"
                >
                  Discord
                </a>
                <a href="mailto:adspacesfun@gmail.com" className="transition-colors hover:text-white">
                  Email support
                </a>
              </div>
            </div>

            <div>
              <p className="mb-4 text-[12px] font-semibold uppercase tracking-wider text-white/40">
                Legal & Safety
              </p>
              <div className="flex flex-col space-y-2.5 text-[14px] text-white/65">
                <Link href="/terms" className="transition-colors hover:text-white">
                  Terms of Service
                </Link>
                <span className="text-white/80">Proof verification</span>
                <span className="text-white/80">3-Day review window</span>
                <span className="text-white/50 text-[13px]">Platform fee (2.5%)</span>
                <span className="text-white/50 text-[13px]">Devnet sandbox only</span>
              </div>
            </div>
          </div>
          */}

          {/* Bottom Bar */}
          <div className="flex flex-wrap items-center justify-between gap-4 text-[13px] text-white/40">
            <div className="flex items-center gap-4">
              <span>© {new Date().getFullYear()} Adspaces Inc.</span>
              <span className="hidden sm:inline">·</span>
              <a
                href="mailto:adspacesfun@gmail.com"
                className="transition-colors hover:text-white/80"
              >
                adspacesfun@gmail.com
              </a>
            </div>

            {/* FUTURE: network status pill — restore when surfacing chain status.
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
              </span>
              <span className="text-white/60">Solana Devnet Active · P2P Ad Protocol</span>
            </div>
            */}
          </div>
        </div>
      </footer>
    </div>
  )
}
