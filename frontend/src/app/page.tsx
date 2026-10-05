'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'motion/react'
import Link from 'next/link'
import {
  ArrowRight,
  Minus,
  Plus,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PageShell from '@/components/PageShell'
import SellerAvatar from '@/components/SellerAvatar'
import { cardPhoto, listingUrl, sellerDisplay } from '@/lib/listings'
import { useStore } from '@/components/StoreProvider'
import { useSurfacePicker } from '@/components/SurfacePickerModal'

const HERO_IMAGES = [
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124082/adspaces/static/landing/hero-1.png',
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124086/adspaces/static/landing/hero-2.png',
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124090/adspaces/static/landing/hero-3.png',
]
const STEP_IMAGES = [
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124092/adspaces/static/landing/step-1.jpg',
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124094/adspaces/static/landing/step-2.jpg',
  'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124096/adspaces/static/landing/step-3.jpg',
]
const CTA_GRADIENT_IMAGE = 'https://res.cloudinary.com/jvd3gsf7/image/upload/v1791124097/adspaces/static/landing/cta-gradient.jpg'

/**
 * Step panel visual. Cover-crops its image so the BOX can resize freely.
 * Temporarily on the hero shots — point at `/step-N.png` once those land.
 * Falls back to navy + icon, never a broken image.
 */
function StepImage({ src, label, icon }: { src: string; label: string; icon: React.ReactNode }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <span className="grid h-full w-full place-items-center bg-[#0a1730] text-white/70">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-white/10">{icon}</span>
        <span className="sr-only">{label}</span>
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

const steps = [  {
    icon: Sparkles,
    title: 'List your surface',
    text: 'Suitcase, bike, laptop, body, physical or digital — split into spots with prices.',
    checks: ['Fixed price or auction', 'Every price above zero', 'Deadline in the future'],
  },
  {
    icon: Target,
    title: 'Buyers claim or bid',
    text: 'Fixed spots get claimed. Auction spots get bid up. X login required.',
    checks: ['Claim fixed, bid auctions only', 'Taken spots return 409', 'Min increment or double-up'],
  },
  {
    icon: Zap,
    title: 'You approve',
    text: 'Approve, reject, or mark fulfilled from your dashboard. Payouts settle in devnet USDC.',
    checks: ['Approve / reject / fulfill', 'Records stay in Postgres', 'Devnet USDC payouts'],
  },
]

const faqs = [
  {
    q: 'Do I need an account to browse?',
    a: 'No to browse. Yes with X to list, claim, or bid — seller and buyer come from the session, never a typed name.',
  },
  {
    q: 'Is real money involved?',
    a: 'Devnet only. Claims and bids move devnet USDC through the on-chain program — no mainnet funds, no card.',
  },
  {
    q: 'What surfaces can I list?',
    a: 'Gear, body, physical, digital, reach. Suitcase, bike, laptop, tattoos — if people see it, list it.',
  },
  {
    q: 'How do auctions work?',
    a: 'First bid at or above the price. Later bids beat it by the min increment — or double it when double-up is on.',
  },
]

const FAQ_MOTION = {
  stagger: 0.06,
  offsetY: 16,
  spring: { type: 'spring' as const, stiffness: 280, damping: 26 },
  expand: { type: 'spring' as const, stiffness: 350, damping: 32 },
} as const

export default function Home() {
  const { listings } = useStore()
  const { openPicker } = useSurfacePicker()
  const [slide, setSlide] = useState(0)
  const [paused, setPaused] = useState(false)
  const [activeStep, setActiveStep] = useState(0)
  const [stepsPaused, setStepsPaused] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  // Workflow panels: the active step expands while the others sit narrow.
  // Steps auto-advance on a timer; pausing (hover/focus) freezes it;
  // reduced motion leaves step one statically active.
  const advanceStep = useCallback(() => setActiveStep((s) => (s + 1) % steps.length), [])

  // Hero carousel: crossfade every 2s. Stays on the first frame when the
  // user prefers reduced motion; pauses while hovered or focused.
  useEffect(() => {
    if (paused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(() => setSlide((s) => (s + 1) % HERO_IMAGES.length), 2000)
    return () => window.clearInterval(id)
  }, [paused])

  useEffect(() => {
    if (stepsPaused || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = window.setInterval(advanceStep, 4000)
    return () => window.clearInterval(id)
  }, [stepsPaused, advanceStep])

  return (
    <>
      <PageShell>
        <Header />
        <main className="bg-[#f4f4f4]">
        {/* Hero — Awwwards Site-of-the-Day treatment. Gray is sampled from
            awwwards.com (#f4f4f4); type stays on the ink token. */}
        <section className="relative overflow-hidden bg-[#f4f4f4]">
          <div className="relative mx-auto flex w-full max-w-[1340px] flex-col items-center px-6 pb-14 pt-20 text-center">
            <motion.h1
              initial={{ opacity: 0, y: 28 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="whitespace-nowrap font-extrabold lowercase text-[#020817]"
              style={{ fontSize: 'clamp(28px, 8.2vw, 120px)', letterSpacing: '-0.04em', lineHeight: 0.95 }}
            >
              Attention is everywhere
            </motion.h1>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
            className="w-full px-3"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
            onFocus={() => setPaused(true)}
            onBlur={() => setPaused(false)}
          >
            <div className="relative w-full overflow-hidden rounded-2xl bg-black" role="region" aria-roledescription="carousel" aria-label="Featured ad spaces">
              {HERO_IMAGES.map((src, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={src}
                  src={src}
                  alt={i === 0 ? 'A marketplace of live ad spaces' : ''}
                  aria-hidden={i !== slide}
                  className={`h-auto w-full motion-safe:transition-opacity motion-safe:duration-700 ${i === 0 ? 'relative' : 'absolute inset-0'} ${i === slide ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
                />
              ))}
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2">
                {HERO_IMAGES.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSlide(i)}
                    aria-label={`Show slide ${i + 1}`}
                    aria-current={i === slide}
                    className={`h-2 rounded-full transition-all motion-safe:duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${i === slide ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/80'}`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        </section>

        {/* How it works */}
        <section id="how" className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 text-center">
              <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#020817]">How it works</p>
              <h2 className="font-extrabold uppercase text-[#020817]" style={{ fontSize: 'clamp(24px, 4vw, 56px)', letterSpacing: '-0.04em', lineHeight: 0.95 }}>Workflow</h2>
              <p className="mx-auto mt-6 max-w-[48ch] text-[17px] text-[#020817]/70">List it, sell it, approve it. The seller always comes from your X session — never a typed name.</p>
            </div>
            <MotionConfig reducedMotion="user">
            <div
              className="flex flex-col gap-4 md:flex-row"
              onMouseEnter={() => setStepsPaused(true)}
              onMouseLeave={() => setStepsPaused(false)}
              onFocus={() => setStepsPaused(true)}
              onBlur={() => setStepsPaused(false)}
            >
              {steps.map((s, i) => {
                const active = i === activeStep
                return (
                  <motion.div
                    key={s.title}
                    initial={false}
                      animate={{ flexGrow: active ? 2 : 1 }}
                    transition={{ type: 'spring', stiffness: 90, damping: 24 }}
                    style={{ flexBasis: 0 }}
                    className="min-w-0"
                    onMouseEnter={() => setActiveStep(i)}
                  >
                    <article
                      aria-current={active}
                      className="relative h-full min-h-[300px] overflow-hidden rounded-3xl bg-[#0a1730] md:min-h-[440px]"
                    >
                      <StepImage src={STEP_IMAGES[i] ?? HERO_IMAGES[i] ?? HERO_IMAGES[0]} label={s.title} icon={<s.icon size={24} />} />
                    </article>
                    <div className="px-1 pt-6">
                      <h3 className="text-2xl lowercase tracking-tight text-[#020817]">{s.title}</h3>
                      {active && (
                        <p className="mt-2 max-w-[44ch] text-[15px] leading-6 text-[#64748b]">{s.text}</p>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>
            </MotionConfig>
          </div>
        </section>

        {/* Live listings - centered heading, cards, footer link */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <div className="mb-12 text-center">
              <p className="mb-4 text-sm font-medium uppercase tracking-[0.22em] text-[#020817]">Live now</p>
              <h2 className="font-extrabold uppercase text-[#020817]" style={{ fontSize: 'clamp(24px, 4vw, 56px)', letterSpacing: '-0.04em', lineHeight: 0.95 }}>Live spaces</h2>
              <p className="mx-auto mt-6 max-w-[48ch] text-[17px] text-[#020817]/70">Suitcases, kits, lids, tattoos. Pick a spot - X login to claim or bid.</p>
            </div>
            {listings.length === 0 ? (
              <>
                <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3" aria-label="Example spaces">
                  {[
                    { src: HERO_IMAGES[0], title: 'Suitcase to TOKEN2049', seller: '@coinempress' },
                    { src: HERO_IMAGES[1], title: 'Ironman kit + frame', seller: '@winternet' },
                    { src: HERO_IMAGES[2], title: 'Laptop lid auction', seller: '@VynseDev' },
                  ].map((ex) => (
                    <div key={ex.title} className="block">
                      <div className="relative overflow-hidden rounded-2xl bg-[#e9edfe]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ex.src}
                          alt={ex.title}
                          loading="lazy"
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-white/90 px-3 py-[5px] font-mono text-[11px] font-medium uppercase tracking-wide text-[#64748b]">
                          Example
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-4">
                        <span className="text-[17px] font-semibold text-[#020817]">{ex.title}</span>
                        <span className="text-sm text-[#64748b]">by</span>
                        <span className="text-[15px] font-medium text-[#020817] underline decoration-[#e7e5e0] underline-offset-4">
                          {ex.seller}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-12 flex flex-wrap items-center justify-center gap-2 text-[15px]">
                  <span className="text-[#64748b]">Check out all live spaces</span>
                  <ArrowRight size={16} aria-hidden="true" />
                  <Link href="/browse" className="font-medium text-[#020817] underline underline-offset-4 transition hover:text-[#4166fb]">
                    Browse all
                  </Link>
                </div>
              </>
            ) : (
              <>
                <div className="grid gap-x-6 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
                  {listings.slice(0, 3).map((listing) => {
                    const photo = cardPhoto(listing)
                    return (
                      <Link key={listing.id} href={listingUrl(listing, listings)} className="group block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] focus-visible:ring-offset-2">
                        <div className="overflow-hidden rounded-2xl bg-[#e9edfe]">
                          {photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo}
                              alt={listing.title}
                              loading="lazy"
                              className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-[1.02]"
                            />
                          ) : (
                            <div
                              aria-hidden="true"
                              className="grid aspect-[4/3] w-full place-items-center"
                              style={{ background: `linear-gradient(135deg, ${listing.seller.color}22, #e9edfe)` }}
                            >
                              <span className="font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">
                                {listing.title}
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-4">
                          <span className="text-[17px] font-semibold text-[#020817]">{listing.title}</span>
                          <span className="text-sm text-[#64748b]">by</span>
                          <SellerAvatar seller={listing.seller} className="h-6 w-6 text-xs" />
                          <span className="text-[15px] font-medium text-[#020817] underline decoration-[#e7e5e0] underline-offset-4 transition group-hover:decoration-[#020817]">
                            {sellerDisplay(listing.seller)}
                          </span>
                        </div>
                      </Link>
                    )
                  })}
                </div>
                <div className="mt-12 flex flex-wrap items-center justify-center gap-2 text-[15px]">
                  <span className="text-[#64748b]">Check out all live spaces</span>
                  <ArrowRight size={16} aria-hidden="true" />
                  <Link href="/browse" className="font-medium text-[#020817] underline underline-offset-4 transition hover:text-[#4166fb]">
                    Browse all
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>

        {/* FAQ — sticky intro + single-open accordion.
            Storyboard: header fades up (0ms) → rows cascade i*60ms →
            open row expands on spring (350/32), chevron rotates (400/25). */}
        <section id="faq" className="bg-[#f4f4f4] py-20">
          <div className="mx-auto grid w-full max-w-[1340px] gap-12 px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <motion.div
              initial={{ opacity: 0, y: FAQ_MOTION.offsetY }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={FAQ_MOTION.spring}
              className="lg:sticky lg:top-24 lg:self-start"
            >
              <span className="mb-4 block font-mono text-xs font-medium uppercase tracking-[0.08em] text-[#64748b]">FAQ</span>
              <h2 className="font-semibold tracking-tight text-[#020817]" style={{ fontSize: 'clamp(30px, 4vw, 44px)', lineHeight: 1.05 }}>
                Frequently asked questions.
              </h2>
              <p className="mt-4 max-w-[40ch] text-[15px] leading-6 text-[#64748b]">
                Browsing is open. Listing, claiming, and bidding need an X login — identity always comes from your session.
              </p>
            </motion.div>

            <MotionConfig reducedMotion="user">
              <div>
                {faqs.map((f, i) => {
                  const open = openFaq === i
                  return (
                    <motion.div
                      key={f.q}
                      initial={{ opacity: 0, y: FAQ_MOTION.offsetY }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ ...FAQ_MOTION.spring, delay: i * FAQ_MOTION.stagger }}
                    >
                      <button
                        type="button"
                        onClick={() => setOpenFaq(open ? null : i)}
                        aria-expanded={open}
                        aria-controls={`faq-panel-${i}`}
                        className="flex w-full items-center gap-4 px-1 py-6 text-left motion-safe:transition-colors motion-safe:duration-150 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4166fb] sm:px-2"
                      >
                        <span aria-hidden="true" className="font-mono text-xs tabular-nums text-[#64748b]">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        <span className="flex-1 text-[16px] font-medium tracking-tight text-[#020817]">{f.q}</span>
                        <motion.span
                          aria-hidden="true"
                          whileTap={{ scale: 0.85 }}
                          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
                          className="grid h-6 w-6 shrink-0 place-items-center text-[#020817]"
                        >
                          <AnimatePresence mode="wait" initial={false}>
                            <motion.span
                              key={open ? 'minus' : 'plus'}
                              initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
                              animate={{ opacity: 1, rotate: 0, scale: 1 }}
                              exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
                              transition={{ duration: 0.18, ease: 'easeOut' }}
                              className="grid place-items-center"
                            >
                              {open ? <Minus size={16} /> : <Plus size={16} />}
                            </motion.span>
                          </AnimatePresence>
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {open && (
                          <motion.div
                            key="content"
                            id={`faq-panel-${i}`}
                            role="region"
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={FAQ_MOTION.expand}
                            style={{ overflow: 'hidden' }}
                          >
                            <motion.p
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.18, ease: 'easeOut' }}
                              className="pb-7 pl-9 pr-14 text-[15px] leading-6 text-[#64748b] sm:pl-10"
                            >
                              {f.a}
                            </motion.p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  )
                })}
              </div>
            </MotionConfig>
          </div>
        </section>

        {/* CTA */}
        <section className="py-20">
          <div className="mx-auto w-full max-w-[1340px] px-6">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-80px' }}
              transition={{ type: 'spring', stiffness: 160, damping: 24 }}
              className="relative flex flex-col items-center overflow-hidden rounded-[32px] bg-[#020817] px-8 py-20 text-center ring-1 ring-white/10 sm:py-24"
            >
              {/* Rich generated gradient background with luminous glow and legibility overlays */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={CTA_GRADIENT_IMAGE}
                  alt=""
                  className="h-full w-full object-cover object-center opacity-90"
                />
                <div className="absolute inset-0 bg-[#020817]/30" />
                <div className="absolute inset-0 bg-gradient-to-b from-[#020817]/60 via-transparent to-[#020817]/85" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_40%,#020817_95%)]" />
              </div>
              <div aria-hidden="true" className="pointer-events-none absolute inset-x-16 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
              <h2 className="relative font-semibold tracking-tight text-white" style={{ fontSize: 'clamp(28px, 4vw, 44px)', lineHeight: 1.05 }}>
                Got a suitcase, bike, laptop, <em className="italic text-[#4166fb]">or body?</em>
              </h2>
              <p className="relative mt-5 max-w-[52ch] text-[17px] leading-7 text-slate-300/80">List spots in under a minute. Devnet publishing, no mainnet charge.</p>
              <div className="relative mt-10 flex flex-wrap justify-center gap-4">
                <Link href="/browse" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.06] px-9 py-4 text-[17px] font-medium text-white backdrop-blur motion-safe:transition-[transform,background-color,border-color] motion-safe:duration-150 hover:-translate-y-px hover:bg-white/[0.12] active:translate-y-0 active:scale-[0.98]">
                  Browse live spaces
                </Link>
                <button
                  type="button"
                  onClick={openPicker}
                  className="group inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-9 py-4 text-[17px] font-medium text-white shadow-[0_10px_40px_-8px_rgba(65,102,251,0.7)] motion-safe:transition-[transform,background-color] motion-safe:duration-150 hover:-translate-y-px hover:bg-[#3558e8] active:translate-y-0 active:scale-[0.98]"
                >
                  List your space <ArrowRight size={19} aria-hidden="true" className="motion-safe:transition-transform motion-safe:duration-150 group-hover:translate-x-0.5" />
                </button>
              </div>

            </motion.div>
          </div>
        </section>
      </main>
    </PageShell>
    <Footer />
  </>
)
}
