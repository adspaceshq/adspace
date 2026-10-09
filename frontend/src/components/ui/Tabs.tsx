import Link from "next/link";
import { cx } from "@/lib/cx";

export interface TabItem {
  href: string;
  label: string;
  count?: number;
}

// Tabs are links so every view is deep-linkable and survives reloads and back navigation.
export function Tabs({ items, active }: { items: TabItem[]; active: string }) {
  return (
    <nav aria-label="Sections" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line no-scrollbar">
      {items.map((item) => {
        const selected = item.href === active;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={selected ? "page" : undefined}
            className={cx(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-body font-medium transition-colors",
              selected ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {item.label}
            {item.count !== undefined && item.count > 0 && (
              <span className="rounded-full bg-ink/5 px-1.5 text-caption text-ink">{item.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
