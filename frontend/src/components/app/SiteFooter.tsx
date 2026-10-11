import Link from "next/link";
import Logo from "@/components/Logo";

const year = new Date().getFullYear();

// Full footer for public pages; same content as the landing, without its curtain-reveal effect.
export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div className="flex flex-col gap-3">
          <Link href="/" className="flex items-center gap-2" aria-label="adspaces home">
            <Logo size={28} />
            <span className="text-lead font-semibold">adspaces</span>
          </Link>
          <p className="max-w-xs text-small text-white/60">sell ad space on anything people actually see.</p>
        </div>
        <FooterColumn
          title="marketplace"
          links={[
            { href: "/browse", label: "browse spaces" },
            { href: "/sell", label: "list your space" },
            { href: "/#how", label: "how it works" },
          ]}
        />
        <FooterColumn
          title="company"
          links={[
            { href: "/#faq", label: "faq" },
            { href: "https://x.com/adspacesfun", label: "x / twitter" },
            { href: "mailto:support@adspaces.fun", label: "support" },
          ]}
        />
        <FooterColumn
          title="legal"
          links={[
            { href: "/terms", label: "terms" },
            { href: "/privacy", label: "privacy" },
          ]}
        />
      </div>
      <div className="border-t border-white/10">
        <p className="mx-auto max-w-7xl px-4 py-5 text-caption text-white/50 sm:px-6">© {year} adspaces</p>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: Array<{ href: string; label: string }> }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-caption font-medium uppercase tracking-wide text-white/50">{title}</p>
      {links.map((link) => (
        <Link key={link.href} href={link.href} className="text-body text-white/80 hover:text-white">
          {link.label}
        </Link>
      ))}
    </div>
  );
}

// One-line footer for app pages; hidden on mobile where the bottom tabs sit.
export function CompactFooter() {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-30 hidden border-t border-line bg-canvas/95 backdrop-blur-md lg:block">
      <div className="mx-auto flex h-12 max-w-7xl items-center justify-between px-6 text-small text-muted">
        <span>© {year} adspaces</span>
        <nav aria-label="footer" className="flex gap-4">
          <Link href="/terms" className="hover:text-ink">terms</Link>
          <Link href="/privacy" className="hover:text-ink">privacy</Link>
          <a href="mailto:support@adspaces.fun" className="hover:text-ink">support</a>
        </nav>
      </div>
    </footer>
  );
}
