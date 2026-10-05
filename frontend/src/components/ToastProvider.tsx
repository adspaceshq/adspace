'use client'

import {
  CheckCircle2,
  Info,
  Loader2,
  TriangleAlert,
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

const toneStyles: Record<ToastTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  error: 'border-rose-200 bg-rose-50 text-rose-950',
  info: 'border-[#d8dffb] bg-[#f3f6ff] text-[#020817]',
  loading: 'border-[#e7e5e0] bg-white text-[#020817]',
}

const toneIcons: Record<ToastTone, React.ReactNode> = {
  success: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />,
  error: <XCircle className="h-4 w-4 text-rose-600" aria-hidden />,
  info: <Info className="h-4 w-4 text-[#4166fb]" aria-hidden />,
  loading: <Loader2 className="h-4 w-4 animate-spin text-[#4166fb]" aria-hidden />,
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
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col-reverse gap-2 sm:bottom-5 sm:right-5"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-start gap-3 rounded-2xl border px-4 py-3 shadow-[0_18px_50px_rgba(2,8,23,0.16)] backdrop-blur ${toneStyles[toast.tone]}`}
          >
            <div className="mt-0.5 shrink-0">{toneIcons[toast.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-5">{toast.title}</p>
              {toast.description ? (
                <p className="mt-0.5 text-sm leading-5 text-[#64748b]">{toast.description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(toast.id)}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[#64748b] transition hover:bg-black/5 hover:text-[#020817] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2"
              aria-label="Dismiss notification"
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
