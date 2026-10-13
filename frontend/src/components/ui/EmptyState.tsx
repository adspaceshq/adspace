import type { LucideIcon } from "lucide-react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line-strong px-6 py-12 text-center">
      {Icon && (
        <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon className="size-5" aria-hidden />
        </span>
      )}
      <div className="max-w-sm">
        <p className="text-lead font-semibold">{title}</p>
        {description && <p className="mt-1 text-body text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}
