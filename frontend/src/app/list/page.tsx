'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import { XProbe, type XIdentity } from '@/components/AuthButton'
import { useStore } from '@/components/StoreProvider'
import { surfaceLabels, type Listing } from '@/lib/listings'
import { PRIVY_ENABLED } from '@/lib/privy'

const field =
  'w-full rounded-lg border border-[#e7e5e0] bg-white px-[14px] py-3 font-[family-name:var(--font-body)] text-[15px] text-[#020817] transition focus:border-[#4166fb] focus:shadow-[0_0_0_3px_#e9edfe] focus:outline-none'

interface SpotDraft {
  label: string
  size: string
  price: string
}

export default function ListPage() {
  const { addListing } = useStore()
  const router = useRouter()

  const [sellerName, setSellerName] = useState('')
  const [title, setTitle] = useState('')
  const [surface, setSurface] = useState('gear')
  const [goal, setGoal] = useState('')
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [priceType, setPriceType] = useState<'fixed' | 'auction'>('fixed')
  const [spots, setSpots] = useState<SpotDraft[]>([{ label: '', size: '', price: '' }])
  const [error, setError] = useState<string | null>(null)
  const [x, setX] = useState<XIdentity | null>(null)

  const updateSpot = (i: number, patch: Partial<SpotDraft>) =>
    setSpots((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)))

  const publish = async (e: React.FormEvent) => {
    e.preventDefault()
    // Seller: verified X handle when Privy is configured, manual name in demo mode.
    if (PRIVY_ENABLED) {
      if (!x?.ready || x.loggingIn) return
      if (!x.authenticated || !x.handle) {
        x.login()
        return
      }
    }
    const seller = PRIVY_ENABLED ? (x?.handle ?? '') : sellerName.trim()
    if (!seller || !title.trim() || spots.length === 0) {
      setError('Your name, a title and at least one spot are required.')
      return
    }
    const prices = spots.map((s) => Number(s.price))
    if (prices.some((p) => !p || p <= 0)) {
      setError('Every spot needs a price above zero.')
      return
    }
    const id = `user-${Date.now()}`
    const listing: Listing = {
      id,
      title: title.trim(),
      goal: goal.trim() || 'Fund my goal',
      description: description.trim(),
      image: '',
      surface,
      seller: { name: seller, handle: PRIVY_ENABLED ? seller : '', color: '#4166fb' },
      deadline: deadline.trim() || 'Soon',
      endsAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      priceType,
      spots: spots.map((s, i) => ({
        id: `${id}-s${i + 1}`,
        label: s.label.trim() || `Spot ${i + 1}`,
        size: s.size.trim() || 'M',
        price: Number(s.price),
      })),
      mockup: {
        views: [
          {
            id: 'main',
            label: 'Overview',
            grid: spots.map((_, i) => [{ spot: `${id}-s${i + 1}`, span: 12 }]),
            dims: { h: '', v: '' },
          },
        ],
      },
    }
    let newId: string
    try {
      newId = await addListing(listing)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish. Try again.')
      return
    }
    router.push(`/listings/${newId}`)
  }

  return (
    <>
      <Header />
      {PRIVY_ENABLED && <XProbe onChange={setX} />}
      <main className="mx-auto w-full max-w-[760px] px-6 pb-16 pt-8">
        <div className="mb-8">
          <h1 className="mb-2" style={{ fontSize: '40px' }}>List your space.</h1>
          <p className="text-[16px] text-[#64748b]">Describe the surface, add the spots, set the prices. Live in under a minute — mock publishing, no charge.</p>
        </div>

        <form onSubmit={publish} className="flex flex-col gap-8">
          <section className="rounded-2xl border border-[#e7e5e0] bg-white p-8">
            <h2 className="mb-6 text-[22px]">The basics</h2>
            <div className="mb-5 flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-name">Your name</label>
              {PRIVY_ENABLED ? (
                x?.authenticated && x.handle ? (
                  <input id="list-name" className={field} value={x.handle} readOnly aria-readonly />
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => x?.login()}
                      disabled={!x?.ready || x?.loggingIn}
                      className="rounded-lg bg-[#020817] px-4 py-3 text-[15px] font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
                    >
                      {x?.loggingIn ? 'Redirecting to X…' : 'Log in with X to list'}
                    </button>
                    {x?.error && <p className="text-sm font-medium text-[#dc2626]">{x.error}</p>}
                  </>
                )
              ) : (
                <input id="list-name" className={field} placeholder="vana" value={sellerName} onChange={(e) => setSellerName(e.target.value)} required />
              )}
            </div>
            <div className="mb-5 flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-title">Title</label>
              <input id="list-title" className={field} placeholder="Put your brand on my …" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="mb-5 flex flex-col gap-[6px]">
              <span className="text-[13px] font-semibold">Surface</span>
              <div className="flex flex-wrap gap-2">
                {Object.entries(surfaceLabels).map(([key, label]) => (
                  <button
                    type="button" key={key} onClick={() => setSurface(key)}
                    className={`rounded-full border px-4 py-[9px] text-[13px] font-medium transition ${
                      surface === key
                        ? 'border-[#020817] bg-[#020817] text-white'
                        : 'border-[#e7e5e0] bg-white text-[#64748b] hover:border-[#64748b] hover:text-[#020817]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-5 grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-goal">Goal</label>
                <input id="list-goal" className={field} placeholder="Fund my trip" value={goal} onChange={(e) => setGoal(e.target.value)} />
              </div>
              <div className="flex flex-col gap-[6px]">
                <label className="text-[13px] font-semibold" htmlFor="list-deadline">Deadline</label>
                <input id="list-deadline" className={field} placeholder="Sep 29" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </div>
            </div>
            <div className="flex flex-col gap-[6px]">
              <label className="text-[13px] font-semibold" htmlFor="list-desc">What does the sponsor get?</label>
              <textarea id="list-desc" rows={3} className={field} placeholder="Miles, events, content, photos…" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </section>

          <section className="rounded-2xl border border-[#e7e5e0] bg-white p-8">
            <h2 className="mb-6 text-[22px]">How spots sell</h2>
            <div className="flex flex-wrap gap-2">
              {(['fixed', 'auction'] as const).map((mode) => (
                <button
                  type="button" key={mode} onClick={() => setPriceType(mode)}
                  className={`rounded-full border px-4 py-[9px] text-[13px] font-medium transition ${
                    priceType === mode
                      ? 'border-[#020817] bg-[#020817] text-white'
                      : 'border-[#e7e5e0] bg-white text-[#64748b] hover:border-[#64748b] hover:text-[#020817]'
                  }`}
                >
                  {mode === 'fixed' ? 'Fixed price' : 'Auction'}
                </button>
              ))}
            </div>
            <p className="mt-3 text-sm text-[#64748b]">
              {priceType === 'fixed'
                ? 'Buyers claim a spot instantly at the price you set.'
                : 'Buyers bid from the starting price. Highest bid wins at close.'}
            </p>
          </section>

          <section className="rounded-2xl border border-[#e7e5e0] bg-white p-8">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-[22px]">Spots</h2>
              <button
                type="button"
                onClick={() => setSpots((prev) => [...prev, { label: '', size: '', price: '' }])}
                className="inline-flex items-center gap-1 rounded-full border border-[#e7e5e0] px-4 py-2 text-[13px] font-medium transition hover:border-[#64748b]"
              >
                <Plus size={14} /> Add spot
              </button>
            </div>
            {spots.map((s, i) => (
              <div key={i} className="mb-3 grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-3 rounded-xl border border-[#e7e5e0] bg-[#fafaf7] p-4">
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] font-semibold">Label</label>
                  <input className={field} value={s.label} onChange={(e) => updateSpot(i, { label: e.target.value })} />
                </div>
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] font-semibold">Size</label>
                  <input className={field} value={s.size} onChange={(e) => updateSpot(i, { size: e.target.value })} />
                </div>
                <div className="flex flex-col gap-[6px]">
                  <label className="text-[13px] font-semibold">{priceType === 'fixed' ? 'Price' : 'Starts at'}</label>
                  <input type="number" min={1} className={field} value={s.price} onChange={(e) => updateSpot(i, { price: e.target.value })} />
                </div>
                <button
                  type="button" aria-label="Remove spot"
                  disabled={spots.length <= 1}
                  onClick={() => setSpots((prev) => prev.filter((_, j) => j !== i))}
                  className="grid h-10 w-10 place-items-center rounded-lg border border-[#e7e5e0] text-[#dc2626] transition hover:border-[#fecaca] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </section>

          {error && <p className="text-sm font-medium text-[#dc2626]">{error}</p>}

          <div className="flex justify-end">
            <button type="submit" className="inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#4166fb] px-7 py-[15px] text-[16px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#3558e8]">
              {PRIVY_ENABLED && (!x?.authenticated || !x.handle) ? 'Log in with X to publish' : 'Publish space'}
            </button>
          </div>
        </form>
      </main>
      <Footer />
    </>
  )
}
