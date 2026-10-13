"use client";

import { useEffect, useRef } from "react";
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
      aria-labelledby="modal-title"
      className={cx(
        "m-auto w-[calc(100%-2rem)] max-w-lg rounded-panel bg-surface p-0 text-ink shadow-pop",
        "backdrop:bg-ink/40 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4 px-6 pt-6">
        <div>
          <h2 id="modal-title" className="text-title font-semibold">
            {title}
          </h2>
          {description && <p className="mt-1 text-body text-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="cursor-pointer rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="px-6 py-5">{children}</div>
      {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
    </dialog>
  );
}
