"use client";

import { useState } from "react";
import { cx } from "@/lib/cx";

export interface BarRow {
  label: string;
  value: number;
  display: string; // the formatted value printed beside the bar
  hint?: string; // extra detail on hover, e.g. "48% of sign-ups"
}

// One series across categories as thin horizontal bars, longest = full width. Values print beside each bar
// in text colour (identity comes from the label, never the bar colour); hovering a row shows its hint.
export function HBars({ title, rows, className }: { title: string; rows: BarRow[]; className?: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((row) => row.value), 0);
  return (
    <figure className={cx("flex flex-col gap-2 rounded-card border border-line bg-surface p-3 shadow-card", className)}>
      <figcaption className="text-small font-medium text-muted">{title}</figcaption>
      {rows.length === 0 ? (
        <p className="text-small text-muted">nothing yet</p>
      ) : (
        <ul className="flex flex-col gap-2" onMouseLeave={() => setActive(null)}>
          {rows.map((row, index) => (
            <li key={row.label} className="flex flex-col gap-1" onMouseEnter={() => setActive(index)}>
              <div className="flex items-baseline justify-between gap-3 text-small">
                <span className="truncate">{row.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {active === index && row.hint ? <span className="mr-2 font-normal text-muted">{row.hint}</span> : null}
                  {row.display}
                </span>
              </div>
              <div className="h-2 rounded-full bg-ink/5">
                <div
                  className={cx("h-2 rounded-full bg-accent transition-opacity", active === null || active === index ? "opacity-100" : "opacity-50")}
                  style={{ width: max > 0 && row.value > 0 ? `${Math.max(2, (row.value / max) * 100)}%` : 0 }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
