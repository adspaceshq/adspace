import Link from 'next/link'

export default function Footer() {
  return (
    <footer className="border-t border-[#e7e5e0] bg-white">
      <div className="mx-auto max-w-[1340px] px-6 pb-8 pt-12">
        <div className="mb-12 grid gap-8 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <p className="mb-3 font-display text-[22px] font-semibold tracking-tight">adspaces</p>
            <p className="max-w-[32ch] text-sm text-[#64748b]">
              A peer-to-peer marketplace for selling ad space on anything — your body, your gear,
              your reach.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-[13px] font-semibold">Product</h4>
            <div className="space-y-3 text-sm text-[#64748b]">
              <Link href="/browse" className="block transition-colors hover:text-[#020817]">Browse listings</Link>
              <Link href="/list" className="block transition-colors hover:text-[#020817]">List your space</Link>
              <Link href="/#how" className="block transition-colors hover:text-[#020817]">How it works</Link>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-[13px] font-semibold">App</h4>
            <div className="space-y-3 text-sm text-[#64748b]">
              <Link href="/" className="block transition-colors hover:text-[#020817]">Home</Link>
              <Link href="/browse" className="block transition-colors hover:text-[#020817]">Browse</Link>
              <Link href="/list" className="block transition-colors hover:text-[#020817]">Seller flow</Link>
            </div>
          </div>
          <div>
            <h4 className="mb-4 text-[13px] font-semibold">Project</h4>
            <div className="space-y-3 text-sm text-[#64748b]">
              <Link href="/#how" className="block transition-colors hover:text-[#020817]">How it works</Link>
              <Link href="/#start" className="block transition-colors hover:text-[#020817]">Getting started</Link>
              <Link href="/" className="block transition-colors hover:text-[#020817]">FAQ</Link>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-between gap-3 border-t border-[#e7e5e0] pt-6 text-[13px] text-[#64748b]">
          <span>© 2026 Adspaces. Demo build only — no real payments are processed.</span>
          <span>Figures shown are for demonstration only.</span>
        </div>
      </div>
    </footer>
  )
}
