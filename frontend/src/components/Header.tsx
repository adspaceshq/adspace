'use client'

import Link from 'next/link'
import AuthButton from '@/components/AuthButton'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-black/10 bg-[#fafaf7]/85 backdrop-blur-md">
      <div className="mx-auto flex h-[52px] max-w-[1340px] items-center gap-8 px-6">
        <Link href="/" className="text-[16px] font-semibold tracking-tight text-[#020817]">
          spotboard
        </Link>
        <nav className="ml-auto hidden items-center gap-6 text-[13px] font-medium text-[#020817]/80 sm:flex" aria-label="Main">
          <Link href="/browse" className="transition-colors hover:text-[#020817]">Browse</Link>
          <Link href="/dashboard" className="transition-colors hover:text-[#020817]">Dashboard</Link>
          <a href="/#how" className="transition-colors hover:text-[#020817]">How it works</a>
          <a href="/#faq" className="transition-colors hover:text-[#020817]">FAQ</a>
        </nav>
        <Link
          href="/list"
          className="rounded-lg bg-[#020817] px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#0f1a33]"
        >
          List your space
        </Link>
        <AuthButton />
      </div>
    </header>
  )
}
