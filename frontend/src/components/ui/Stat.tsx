import { cx } from "@/lib/cx";

export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1", className)}>
      <span className="text-small text-muted">{label}</span>
      <span className="text-title font-semibold tabular-nums">{value}</span>
      {hint && <span className="text-caption text-subtle">{hint}</span>}
    </div>
  );
}
