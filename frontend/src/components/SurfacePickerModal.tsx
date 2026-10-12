'use client'

import React, { createContext, useContext, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowRight, X } from 'lucide-react'
import { MAC_LID_PHOTO } from '@/lib/assets'
import { TEE_PREVIEW_IMAGE as TSHIRT_PREVIEW_IMAGE } from '@/lib/assets'

interface SurfacePickerContextType {
  isOpen: boolean
  openPicker: () => void
  closePicker: () => void
}

const SurfacePickerContext = createContext<SurfacePickerContextType>({
  isOpen: false,
  openPicker: () => {},
  closePicker: () => {},
})

export const useSurfacePicker = () => useContext(SurfacePickerContext)

export function SurfacePickerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const router = useRouter()

  const openPicker = () => setIsOpen(true)
  const closePicker = () => setIsOpen(false)

  const handleSelect = () => {
    closePicker()
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/sell')) {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <SurfacePickerContext.Provider value={{ isOpen, openPicker, closePicker }}>
      {children}

      <AnimatePresence>
        {isOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="surface-picker-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#020817]/70 p-4 backdrop-blur-md sm:p-6"
            onClick={closePicker}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, y: 20 }}
              transition={{ type: 'spring', stiffness: 300, damping: 28 }}
              className="relative max-h-[92vh] w-full max-w-[880px] overflow-y-auto rounded-[36px] border border-[#e7e5e0] bg-[#f4f4f4] p-6 shadow-[0_32px_80px_rgba(2,8,23,0.35)] sm:p-9"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="mb-8 flex items-start justify-between gap-4">
                <div>
                  <h2
                    id="surface-picker-title"
                    className="font-extrabold lowercase text-[#020817]"
                    style={{ fontSize: 'clamp(30px, 4.2vw, 44px)', letterSpacing: '-0.04em', lineHeight: 1 }}
                  >
                    pick your canvas.
                  </h2>
                  <p className="mt-3 max-w-[56ch] text-[15px] leading-relaxed text-[#64748b] sm:text-[16px]">
                    Select which surface you want to list. You can drop spots, set prices, and configure everything directly on the interactive mockup.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePicker}
                  aria-label="Close dialog"
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-[#64748b] shadow-xs transition hover:bg-[#020817] hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Visual Showcase Cards (2 Columns) */}
              <div className="grid gap-6 md:grid-cols-2">
                {/* MacBook Lid Card */}
                <Link
                  href="/sell/new?surface=laptop"
                  onClick={handleSelect}
                  className="group relative flex flex-col overflow-hidden rounded-3xl bg-white p-5 text-left shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(2,8,23,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#020817]"
                >
                  {/* Visual Preview Frame */}
                  <div className="relative mb-5 flex h-48 w-full items-center justify-center overflow-hidden rounded-2xl bg-[#ecebe6] p-4 transition-colors group-hover:bg-[#e6e4df]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={MAC_LID_PHOTO}
                      alt="MacBook Lid preview"
                      className="max-h-full w-auto object-contain drop-shadow-md transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>

                  {/* Body Content */}
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <h3 className="text-2xl font-bold tracking-tight text-[#020817]">MacBook lid</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                        Stickers on the outer lid and keyboard deck. Best for founders, developers, and conference attendees.
                      </p>
                    </div>

                    {/* Launch Pill */}
                    <div className="mt-6 flex items-center justify-between rounded-full bg-[#020817] px-5 py-3.5 text-sm font-semibold text-white transition-all duration-200 group-hover:bg-black group-hover:shadow-[0_8px_24px_rgba(2,8,23,0.25)]">
                      <span>List MacBook lid</span>
                      <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>

                {/* T-Shirt Card */}
                <Link
                  href="/sell/new?surface=tshirt"
                  onClick={handleSelect}
                  className="group relative flex flex-col overflow-hidden rounded-3xl bg-white p-5 text-left shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_20px_40px_-12px_rgba(2,8,23,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#020817]"
                >
                  {/* Visual Preview Frame */}
                  <div className="relative mb-5 flex h-48 w-full items-center justify-center overflow-hidden rounded-2xl bg-[#0a1730] p-0 transition-colors">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={TSHIRT_PREVIEW_IMAGE}
                      alt="T-shirt model preview"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0a1730]/60 to-transparent" />
                  </div>

                  {/* Body Content */}
                  <div className="flex flex-1 flex-col justify-between">
                    <div>
                      <h3 className="text-2xl font-bold tracking-tight text-[#020817]">T-shirt</h3>
                      <p className="mt-2 text-[14px] leading-relaxed text-[#64748b]">
                        Print zones across front, back, and sleeves. Ideal for hackathon teams, community drops, and athlete kits.
                      </p>
                    </div>

                    {/* Launch Pill */}
                    <div className="mt-6 flex items-center justify-between rounded-full bg-[#020817] px-5 py-3.5 text-sm font-semibold text-white transition-all duration-200 group-hover:bg-black group-hover:shadow-[0_8px_24px_rgba(2,8,23,0.25)]">
                      <span>List T-shirt</span>
                      <ArrowRight size={17} className="transition-transform duration-200 group-hover:translate-x-1" />
                    </div>
                  </div>
                </Link>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </SurfacePickerContext.Provider>
  )
}
