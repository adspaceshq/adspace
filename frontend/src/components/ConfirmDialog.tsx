'use client'

import { AlertTriangle, X } from 'lucide-react'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'default'
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}

export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  busy,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  if (!open) return null

  const confirmClass =
    tone === 'danger'
      ? 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500'
      : 'bg-[#020817] text-white hover:bg-[#0f172a] focus-visible:ring-[#4166fb]'

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-[#020817]/65 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div className="w-full max-w-md rounded-[28px] border border-[#e7e5e0] bg-white p-6 shadow-[0_24px_70px_rgba(2,8,23,0.24)]">
        <div className="flex items-start gap-4">
          <div
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${
              tone === 'danger' ? 'bg-rose-50 text-rose-600' : 'bg-[#f3f6ff] text-[#4166fb]'
            }`}
            aria-hidden
          >
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 id="confirm-dialog-title" className="text-lg font-semibold tracking-tight text-[#020817]">
              {title}
            </h2>
            <p id="confirm-dialog-description" className="mt-2 text-sm leading-6 text-[#64748b]">
              {description}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[#64748b] transition hover:bg-[#f4f4f4] hover:text-[#020817] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
            aria-label="Close confirmation"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="min-h-11 rounded-xl border border-[#e7e5e0] bg-white px-4 py-2 text-sm font-semibold text-[#020817] transition hover:bg-[#fafaf7] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy ? 'true' : undefined}
            className={`min-h-11 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm transition disabled:cursor-wait disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${confirmClass}`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
