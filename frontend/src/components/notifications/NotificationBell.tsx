"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useNotifications } from "@/lib/use-notifications";
import { useNow } from "@/lib/use-now";
import { NotificationItem } from "./NotificationItem";

export function NotificationBell() {
  const { enabled, data, markRead } = useNotifications();
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const now = useNow(60_000);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!enabled) return null;
  const unread = data?.unread ?? 0;
  const items = (data?.items ?? []).slice(0, 8);

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread ? `notifications, ${unread} unread` : "notifications"}
        aria-expanded={open}
        className="relative cursor-pointer rounded-full p-2 text-muted hover:bg-ink/5 hover:text-ink"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-panel border border-line bg-surface shadow-card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-body font-semibold">notifications</p>
            {unread > 0 && (
              <button type="button" onClick={() => markRead.mutate(undefined)} className="cursor-pointer text-small text-accent hover:underline">
                mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-small text-muted">you&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {items.map((item) => (
                <li key={item.id}>
                  <NotificationItem
                    item={item}
                    now={now}
                    onOpen={() => {
                      setOpen(false);
                      if (!item.readAt) markRead.mutate([item.id]);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
          <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-line px-4 py-3 text-center text-small font-medium text-accent hover:bg-ink/5">
            see all
          </Link>
        </div>
      )}
    </div>
  );
}
