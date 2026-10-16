"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/cx";

// Native <dialog> gives focus trapping, Escape-to-close and inert background for free.
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  suspended = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  // A modal <dialog> sits in the browser's top layer and makes the rest of the page inert, which
  // hides and blocks Privy's own popups (two-factor, signing). While true, the dialog steps aside
  // without counting as closed, and comes back when the external popup is done.
  suspended?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const suspending = useRef(false);
  // Unique per dialog: pages like wallet and ops mount several at once.
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const visible = open && !suspended;
    if (visible && !dialog.open) dialog.showModal();
    if (!visible && dialog.open) {
      suspending.current = open && suspended;
      dialog.close();
    }
  }, [open, suspended]);

  return (
    <dialog
      ref={ref}
      onClose={() => {
        if (suspending.current) {
          suspending.current = false;
          return;
        }
        onClose();
      }}
      onClick={(event) => {
        if (event.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cx(
        // Header and footer stay put; only the body scrolls, inside the rounded card. `open:flex` keeps
        // the closed dialog hidden (a bare `flex` would override the browser's display: none).
        "m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-panel bg-surface p-0 text-ink shadow-pop open:flex",
        // Phones: a bottom sheet, full width and anchored to the bottom edge, so long forms get the height.
        "max-sm:mb-0 max-sm:max-h-[calc(100dvh-1rem)] max-sm:w-full max-sm:max-w-full max-sm:rounded-b-none max-sm:pb-[env(safe-area-inset-bottom)]",
        "backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-6">
        <div>
          <h2 id={titleId} className="text-title font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-body text-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="close"
          className="-mr-1.5 -mt-1.5 flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink pointer-coarse:size-11"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
      {footer && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-6 py-4 max-sm:[&>*]:flex-1">{footer}</div>}
    </dialog>
  );
}
