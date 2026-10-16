"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Logo from "@/components/Logo";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { AccountMenu } from "./AccountMenu";
import { MobileMenu } from "./MobileMenu";
import { WalletChip } from "./WalletChip";

const links = [
  { href: "/browse", label: "browse" },
  { href: "/sell", label: "sell" },
];

// `inSidebar`: app pages show the account card at the bottom of the sidebar on desktop instead of here.
export function TopBar({ inSidebar = false }: { inSidebar?: boolean }) {
  const pathname = usePathname();
  const { ready, session, signIn, signOut } = useSession();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6 md:gap-6">
        {!inSidebar && <MobileMenu signedIn={Boolean(session)} />}
        <Link href="/browse" className="flex min-h-11 items-center gap-2" aria-label="adspaces home">
          <Logo size={28} />
          <span className="text-lead font-semibold tracking-tight">adspaces</span>
        </Link>
        <nav aria-label="primary" className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={pathname.startsWith(link.href) ? "page" : undefined}
              className={cx(
                "flex min-h-11 items-center rounded-control px-3 text-body font-medium transition-colors",
                pathname.startsWith(link.href) ? "text-ink" : "text-muted hover:text-ink",
              )}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {!ready ? (
            <span className="h-9 w-24 animate-pulse rounded-full bg-ink/5" />
          ) : session ? (
            <>
              <span className="hidden sm:block">
                <WalletChip address={session.walletAddress} />
              </span>
              <NotificationBell />
              <div className={inSidebar ? "lg:hidden" : undefined}>
                <AccountMenu session={session} onSignOut={() => void signOut()} />
              </div>
            </>
          ) : (
            <Button size="sm" onClick={signIn}>
              sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
