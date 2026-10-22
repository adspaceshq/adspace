"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  LifeBuoy,
  Bookmark,
  Compass,
  LayoutDashboard,
  ListChecks,
  Megaphone,
  Plus,
  Settings,
  ShieldCheck,
  Store,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useSession } from "@/lib/session";
import { AccountMenu } from "./AccountMenu";
import { cx } from "@/lib/cx";

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  match?: string;
}

const sidebarSections: Array<{ title?: string; items: NavItem[] }> = [
  {
    items: [
      { href: "/dashboard/creator", label: "creator", icon: Store, match: "/dashboard/creator" },
      { href: "/dashboard/sponsor", label: "sponsor", icon: Megaphone, match: "/dashboard/sponsor" },
    ],
    title: "dashboard",
  },
  {
    items: [
      { href: "/wallet", label: "wallet", icon: Wallet },
      { href: "/activity", label: "activity", icon: Activity },
      { href: "/watchlist", label: "saved", icon: Bookmark },
      { href: "/settings", label: "settings", icon: Settings },
      { href: "mailto:support@adspaces.fun", label: "need help?", icon: LifeBuoy },
    ],
  },
];

function isActive(pathname: string, item: NavItem) {
  const target = item.match ?? item.href;
  return pathname === target || pathname.startsWith(`${target}/`);
}

export function AppSidebar() {
  const pathname = usePathname();
  const { session, signOut } = useSession();
  const canReview = Boolean(session?.isReviewer || session?.isAdmin);
  const link = (item: NavItem) => {
    const active = isActive(pathname, item);
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cx(
          "flex items-center gap-3 rounded-control px-3 py-2 text-body font-medium transition-colors",
          active ? "bg-surface text-ink shadow-card" : "text-muted hover:bg-ink/5 hover:text-ink",
        )}
      >
        <item.icon className="size-4" aria-hidden />
        {item.label}
      </Link>
    );
  };
  return (
    <nav aria-label="app" className="hidden w-56 shrink-0 flex-col gap-6 self-start py-6 lg:sticky lg:top-16 lg:flex lg:h-[calc(100dvh-7rem)] lg:max-h-full">
      {sidebarSections.map((section, index) => (
        <div key={index} className="flex flex-col gap-1">
          {section.title && <p className="px-3 pb-1 text-caption font-medium uppercase tracking-wide text-subtle">{section.title}</p>}
          {section.items.map(link)}
        </div>
      ))}
      {canReview && (
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          {link({ href: "/review", label: "review", icon: ShieldCheck })}
        </div>
      )}
      <div className="mt-auto flex flex-col gap-3 pt-4">
        {/* The main creator action, X "post"-style. */}
        <Link
          href="/sell"
          className="flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-body font-semibold text-white shadow-card transition-colors hover:bg-ink-soft"
        >
          <Plus className="size-4" aria-hidden /> new listing
        </Link>
        {session && <AccountMenu session={session} onSignOut={() => void signOut()} variant="card" />}
      </div>
    </nav>
  );
}

const tabs: NavItem[] = [
  { href: "/dashboard", label: "home", icon: LayoutDashboard },
  { href: "/browse", label: "browse", icon: Compass },
  { href: "/sell", label: "sell", icon: Plus },
  { href: "/activity", label: "activity", icon: ListChecks },
  { href: "/wallet", label: "wallet", icon: Wallet },
];

// Public pages: the same tabs, but only for someone signed in (guests use the top bar menu).
export function BottomTabs() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="app"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto flex max-w-md">
        {tabs.map((tab) => {
          const active = isActive(pathname, tab);
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-medium",
                  active ? "text-ink" : "text-muted",
                )}
              >
                <tab.icon className="size-5" aria-hidden />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
