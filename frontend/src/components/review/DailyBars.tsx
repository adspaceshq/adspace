"use client";

import { useState } from "react";
import { cx } from "@/lib/cx";

export interface DailyPoint {
  day: string; // YYYY-MM-DD
  value: number;
  label: string; // formatted value for the tooltip and table
}

// A fixed locale and zone, so the server render and the browser print the same text.
const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// One series of daily values as thin bars. The title names the series, so there is no legend; hovering a
// day shows its value, and a hidden table carries the same numbers for screen readers.
export function DailyBars({ title, total, points, compact = false }: { title: string; total: string; points: DailyPoint[]; compact?: boolean }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...points.map((point) => point.value), 0);
  const shown = active === null ? null : points[active];
  return (
    <figure className={cx("flex flex-col rounded-card border border-line bg-surface shadow-card", compact ? "gap-2 p-3" : "gap-3 p-4")}>
      <figcaption className="flex items-baseline justify-between gap-3">
        <span className="text-small font-medium text-muted">{title}</span>
        <span className="text-body font-semibold tabular-nums">{total}</span>
      </figcaption>
      <div className="relative">
        <div
          className={cx("flex items-end gap-0.5 border-b border-line", compact ? "h-16" : "h-28")}
          role="img"
          aria-label={`${title}, last 30 days: ${total}`}
          onMouseLeave={() => setActive(null)}
        >
          {points.map((point, index) => (
            <button
              key={point.day}
              type="button"
              tabIndex={-1}
              aria-hidden
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              className="group flex h-full min-w-0 flex-1 cursor-default items-end"
            >
              <span
                className={cx(
                  "w-full rounded-t-[4px] transition-colors",
                  point.value > 0 ? "bg-accent" : "bg-transparent",
                  active === index ? "opacity-100" : active === null ? "opacity-90" : "opacity-50",
                )}
                style={{ height: max > 0 && point.value > 0 ? `${Math.max(4, (point.value / max) * 100)}%` : 0 }}
              />
            </button>
          ))}
        </div>
        {shown && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-control bg-ink px-2 py-1 text-caption text-white shadow-pop"
            style={{ left: `${((active! + 0.5) / points.length) * 100}%` }}
          >
            <span className="font-semibold tabular-nums">{shown.label}</span> · {dayLabel(shown.day)}
          </div>
        )}
      </div>
      <div className="flex justify-between text-caption text-muted">
        <span>{points[0] ? dayLabel(points[0].day) : ""}</span>
        <span>{points.at(-1) ? dayLabel(points.at(-1)!.day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{dayLabel(point.day)}</th>
              <td>{point.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
