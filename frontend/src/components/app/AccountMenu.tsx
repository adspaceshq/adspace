"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LayoutDashboard, LogOut, MoreHorizontal, Settings, ShieldCheck, User } from "lucide-react";
import type { Session } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
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

// `avatar`: compact trigger in the top bar, menu drops down.
// `card`: X-style account card at the bottom of the sidebar (avatar, name, handle), menu opens upward.
export function AccountMenu({ session, onSignOut, variant = "avatar" }: { session: Session; onSignOut: () => void; variant?: "avatar" | "card" }) {
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
      {variant === "card" ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-label="account menu"
          className={cx("flex w-full cursor-pointer items-center gap-3 rounded-card p-2 text-left transition-colors hover:bg-ink/5", open && "bg-ink/5")}
        >
          <Avatar session={session} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate text-small font-semibold text-ink">{session.name ?? session.handle.replace(/^@/, "")}</span>
              {/* Test money must never be mistaken for real money; hidden on mainnet. */}
              {ADSPACES_CLUSTER !== "mainnet-beta" && (
                <span className="shrink-0 rounded-full bg-warning-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-warning">
                  {ADSPACES_CLUSTER}
                </span>
              )}
            </span>
            <span className="block truncate text-caption text-muted">@{session.handle.replace(/^@/, "")}</span>
          </span>
          <MoreHorizontal className="size-4 shrink-0 text-muted" aria-hidden />
        </button>
      ) : (
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
      )}
      {open && (
        <div
          role="menu"
          className={cx(
            "absolute z-50 w-60 rounded-card border border-line bg-surface p-1.5 shadow-pop",
            variant === "card" ? "bottom-full left-0 mb-2" : "right-0 top-11",
          )}
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
