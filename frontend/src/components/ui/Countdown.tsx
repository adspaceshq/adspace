"use client";

import { useEffect, useState } from "react";
import { cx } from "@/lib/cx";

export function formatRemaining(ms: number): string {
  if (ms <= 0) return "ended";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.ceil(ms / 1000)}s`;
}

export function Countdown({
  to,
  prefix,
  urgentWithinMs = 24 * 60 * 60 * 1000,
  className,
}: {
  to: string | Date;
  prefix?: string;
  urgentWithinMs?: number;
  className?: string;
}) {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const remaining = target - Date.now();
    const tick = remaining < 60 * 60 * 1000 ? 1_000 : 30_000;
    const id = setInterval(() => setNow(Date.now()), tick);
    return () => clearInterval(id);
  }, [target]);

  const remaining = target - now;
  return (
    // Server and browser render at different instants; the client value wins after hydration.
    <time
      suppressHydrationWarning
      dateTime={new Date(target).toISOString()}
      title={new Date(target).toLocaleString()}
      className={cx(
        "tabular-nums",
        remaining > 0 && remaining < urgentWithinMs ? "text-warning" : remaining <= 0 ? "text-muted" : "",
        className,
      )}
    >
      {prefix ? `${prefix} ` : ""}
      {formatRemaining(remaining)}
    </time>
  );
}
