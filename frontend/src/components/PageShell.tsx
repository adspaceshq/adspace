import type { ReactNode } from 'react'

/**
 * PageShell wraps the header and main content in an opaque, full-width, elevated layer (z-10)
 * with min-h-screen, solid page background, bottom border, and depth shadow.
 * This allows the stationary curtain/reveal footer (z-0) to stay docked at the bottom
 * while the main content slides over the top of it.
 */
export default function PageShell({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`relative z-10 w-full min-h-screen bg-[#f4f4f4] border-b border-[#e5e5e0] shadow-[0_25px_60px_-15px_rgba(0,0,0,0.25)] ${className}`}
    >
      {children}
    </div>
  )
}
