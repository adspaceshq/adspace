"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, LogOut, Settings, ShieldCheck, User } from "lucide-react";
import type { Session } from "@/lib/api/types";
import { cx } from "@/lib/cx";

function Avatar({ session }: { session: Session }) {
  return session.avatar ? (
    // eslint-disable-next-line @next/next/no-img-element -- remote avatar from X/Google, tiny and already sized
    <img src={session.avatar} alt="" className="size-8 rounded-full object-cover" />
  ) : (
    <span className="flex size-8 items-center justify-center rounded-full bg-accent-soft text-small font-semibold text-accent">
      {(session.name ?? session.handle).replace(/^@/, "").slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AccountMenu({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const item = "flex items-center gap-2 rounded-control px-3 py-2 text-body text-ink hover:bg-ink/5";
  const profileHref = `/${session.handle.startsWith("@") ? session.handle : `@${session.handle}`}`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="account menu"
        className="cursor-pointer rounded-full"
      >
        <Avatar session={session} />
      </button>
      {open && (
        <div
          role="menu"
          className={cx("absolute right-0 top-11 z-50 w-60 rounded-card border border-line bg-surface p-1.5 shadow-pop")}
        >
          <div className="px-3 py-2">
            <p className="truncate text-body font-semibold">{session.name ?? session.handle}</p>
            <p className="truncate text-small text-muted">{session.email ?? session.handle}</p>
          </div>
          <div className="my-1 border-t border-line" />
          <Link role="menuitem" href="/dashboard" className={item} onClick={() => setOpen(false)}>
            <LayoutDashboard className="size-4 text-muted" aria-hidden /> dashboard
          </Link>
          <Link role="menuitem" href={profileHref} className={item} onClick={() => setOpen(false)}>
            <User className="size-4 text-muted" aria-hidden /> public profile
          </Link>
          {(session.isReviewer || session.isAdmin) && (
            <Link role="menuitem" href="/review" className={item} onClick={() => setOpen(false)}>
              <ShieldCheck className="size-4 text-muted" aria-hidden /> review
            </Link>
          )}
          <Link role="menuitem" href="/settings" className={item} onClick={() => setOpen(false)}>
            <Settings className="size-4 text-muted" aria-hidden /> settings
          </Link>
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" className={cx(item, "w-full cursor-pointer")} onClick={onSignOut}>
            <LogOut className="size-4 text-muted" aria-hidden /> sign out
          </button>
        </div>
      )}
    </div>
  );
}
