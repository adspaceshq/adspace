import { formatUsd } from "@/lib/money";
import { cx } from "@/lib/cx";

// Renders a base-unit amount; the exact USDC value is always available on hover.
export function Money({
  value,
  compact = false,
  className,
}: {
  value: string | bigint | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  if (value === null || value === undefined) return <span className={cx("text-muted", className)}>—</span>;
  return (
    <span className={cx("tabular-nums", className)} title={`${formatUsd(value)} USDC`}>
      {formatUsd(value, { compact })}
    </span>
  );
}
