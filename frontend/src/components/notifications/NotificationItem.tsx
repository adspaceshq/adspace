"use client";

import Link from "next/link";
import type { AppNotification } from "@/lib/api/types";
import { ago } from "@/lib/activity";

export function NotificationItem({ item, now, onOpen }: { item: AppNotification; now: number; onOpen?: () => void }) {
  const unread = !item.readAt;
  const content = (
    <div className="flex items-start gap-3 px-4 py-3">
      <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-small ${unread ? "font-semibold text-ink" : "text-ink"}`}>{item.title}</p>
        {item.body && <p className="line-clamp-2 text-small text-muted">{item.body}</p>}
      </div>
      <time dateTime={item.createdAt} className="shrink-0 text-caption text-subtle">
        {ago(item.createdAt, now)}
      </time>
    </div>
  );
  return item.href ? (
    <Link href={item.href} onClick={onOpen} className="block hover:bg-ink/5">
      {content}
      {unread && <span className="sr-only">unread</span>}
    </Link>
  ) : (
    content
  );
}
