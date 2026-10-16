import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

// Labelled checkbox: the whole label toggles the box; links inside the label still open normally.
export function Checkbox({
  checked,
  onChange,
  children,
  disabled,
  className,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-2 text-body", disabled && "cursor-not-allowed opacity-60", className)}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="mt-1 size-4 shrink-0 accent-ink"
      />
      <span>{children}</span>
    </label>
  );
}

// Opens a legal page in a new tab so an open form or modal keeps its state.
export function NewTabLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:underline">
      {children}
    </a>
  );
}
