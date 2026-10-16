"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, Compass, LayoutDashboard, Menu, Plus, X } from "lucide-react";
import { cx } from "@/lib/cx";

// Primary links for small screens on public pages, where the top nav is hidden and there's no sidebar.
// A plain disclosure: a button that shows and hides a list of links.
export function MobileMenu({ signedIn }: { signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Close on navigation, outside click and Escape.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const links = [
    { href: "/browse", label: "browse", icon: Compass },
    { href: "/sell", label: "sell", icon: Plus },
    ...(signedIn
      ? [
          { href: "/dashboard", label: "dashboard", icon: LayoutDashboard },
          { href: "/watchlist", label: "saved", icon: Bookmark },
        ]
      : []),
  ];

  return (
    <div ref={ref} className="relative md:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "close menu" : "open menu"}
        className="flex size-11 cursor-pointer items-center justify-center rounded-control text-ink hover:bg-ink/5"
      >
        {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
      </button>
      {open && (
        <nav id={panelId} aria-label="menu" className="absolute left-0 top-12 z-50 w-56 rounded-card border border-line bg-surface p-1.5 shadow-pop">
          <ul className="flex flex-col">
            {links.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cx("flex min-h-11 items-center gap-2 rounded-control px-3 text-body hover:bg-ink/5", active ? "font-medium text-ink" : "text-ink")}
                  >
                    <link.icon className="size-4 text-muted" aria-hidden /> {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
