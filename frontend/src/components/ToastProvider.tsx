'use client'

import {
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

type ToastTone = 'success' | 'error' | 'info' | 'loading'

export interface ToastInput {
  title: string
  description?: string
  tone?: ToastTone
  duration?: number
}

interface ToastItem extends Required<Omit<ToastInput, 'description'>> {
  id: string
  description?: string
}

interface ToastContextValue {
  show: (toast: ToastInput) => string
  success: (title: string, description?: string) => string
  error: (title: string, description?: string) => string
  info: (title: string, description?: string) => string
  loading: (title: string, description?: string) => string
  dismiss: (id: string) => void
  update: (id: string, toast: ToastInput) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

// Same tones as TxStatus, from the design tokens.
const toneStyles: Record<ToastTone, string> = {
  success: 'border-success/30 bg-success-soft text-ink',
  error: 'border-danger/30 bg-danger-soft text-ink',
  info: 'border-accent-ring bg-accent-soft text-ink',
  loading: 'border-line bg-surface text-ink',
}

const toneIcons: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="size-4 text-success" aria-hidden />,
  error: <XCircle className="size-4 text-danger" aria-hidden />,
  info: <Info className="size-4 text-accent" aria-hidden />,
  loading: <Loader2 className="size-4 animate-spin text-accent" aria-hidden />,
}

const DEFAULT_DURATION = 4_500

export default function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Record<string, number>>({})

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current[id]
    if (timer) window.clearTimeout(timer)
    delete timers.current[id]
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      clearTimer(id)
      setToasts((current) => current.filter((toast) => toast.id !== id))
    },
    [clearTimer],
  )

  const scheduleDismiss = useCallback(
    (toast: ToastItem) => {
      clearTimer(toast.id)
      if (toast.tone === 'loading' || toast.duration <= 0) return
      timers.current[toast.id] = window.setTimeout(() => dismiss(toast.id), toast.duration)
    },
    [clearTimer, dismiss],
  )

  const show = useCallback(
    (input: ToastInput) => {
      const id = crypto.randomUUID()
      const toast: ToastItem = {
        id,
        title: input.title,
        description: input.description,
        tone: input.tone ?? 'info',
        duration: input.duration ?? DEFAULT_DURATION,
      }
      setToasts((current) => [toast, ...current].slice(0, 5))
      scheduleDismiss(toast)
      return id
    },
    [scheduleDismiss],
  )

  const update = useCallback(
    (id: string, input: ToastInput) => {
      setToasts((current) =>
        current.map((toast) => {
          if (toast.id !== id) return toast
          const next: ToastItem = {
            ...toast,
            title: input.title,
            description: input.description,
            tone: input.tone ?? toast.tone,
            duration: input.duration ?? DEFAULT_DURATION,
          }
          scheduleDismiss(next)
          return next
        }),
      )
    },
    [scheduleDismiss],
  )

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach(window.clearTimeout)
      timers.current = {}
    }
  }, [])

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      success: (title, description) => show({ title, description, tone: 'success' }),
      error: (title, description) => show({ title, description, tone: 'error', duration: 6_000 }),
      info: (title, description) => show({ title, description, tone: 'info' }),
      loading: (title, description) => show({ title, description, tone: 'loading', duration: 0 }),
      dismiss,
      update,
    }),
    [dismiss, show, update],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        // Top on phones, where bottom tabs and the listing's purchase bar sit; bottom-right from sm up.
        className="pointer-events-none fixed inset-x-4 top-4 z-[100] mx-auto flex max-w-sm flex-col gap-2 sm:inset-x-auto sm:top-auto sm:bottom-5 sm:right-5 sm:mx-0 sm:w-full sm:flex-col-reverse"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tone === 'error' ? 'alert' : 'status'}
            className={`pointer-events-auto flex items-start gap-3 rounded-card border px-4 py-3 shadow-pop ${toneStyles[toast.tone]}`}
          >
            <div className="mt-0.5 shrink-0">{toneIcons[toast.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-small text-muted">{toast.description}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
              aria-label="dismiss"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
