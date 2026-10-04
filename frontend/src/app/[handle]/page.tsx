'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BadgeCheck, ShieldCheck, Wallet } from 'lucide-react'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PageShell from '@/components/PageShell'
import ListingCard from '@/components/ListingCard'
import { useAuthSession } from '@/components/AuthSessionProvider'
import { isEnded, listingUrl } from '@/lib/listings'
import { fetchProfile, updateMyProfile } from '@/lib/auth-api'
import type { PublicProfile } from '@/lib/types'
import { useStore } from '@/components/StoreProvider'
import { useToast } from '@/components/ToastProvider'
import { userErrorMessage } from '@/lib/errors'

const RESERVED = new Set(['browse', 'list', 'listings', 'dashboard', 'review', 'api', 'favicon.ico'])

export default function SellerPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle: raw } = use(params)
  const { listings, hydrated } = useStore()
  const { userId, walletAddress, mfaEnabled, setupMfa, logout } = useAuthSession()
  const toast = useToast()

  const clean = decodeURIComponent(raw ?? '').trim().replace(/^@+/, '').toLowerCase()
  const reserved = RESERVED.has(clean)

  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [loadedHandle, setLoadedHandle] = useState(clean)
  // Reset per-handle state during render (the documented alternative to
  // resetting inside the fetch effect, which cascades renders).
  if (loadedHandle !== clean) {
    setLoadedHandle(clean)
    setProfile(null)
    setProfileMissing(false)
    setEditing(false)
  }
  const [bioDraft, setBioDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Profile-first: the API owns the profile, the listings only fill the grid.
  // A 404 (or an unreachable API) falls back to the listings-derived display.
  useEffect(() => {
    if (reserved || !clean) return
    let cancelled = false
    void (async () => {
      try {
        const found = await fetchProfile(clean)
        if (!cancelled) setProfile(found)
      } catch {
        if (!cancelled) setProfileMissing(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clean, reserved])

  if (reserved) {
    return (
      <>
        <PageShell>
          <Header />
          <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
            <h1 className="text-4xl">Space not found.</h1>
            <Link href="/browse" className="mt-2 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white">
              Back to browse
            </Link>
          </main>
        </PageShell>
        <Footer />
      </>
    )
  }

  const mine = listings.filter((l) => {
    if (l.status !== 'active' || isEnded(l.endsAt)) return false
    const h = (l.seller.handle ?? '').replace(/^@+/, '').toLowerCase()
    const n = (l.seller.name ?? '').replace(/^@+/, '').toLowerCase()
    return h === clean || n === clean
  })

  const isOwner = !!profile && !!userId && profile.id === userId
  const display = profile?.handle ?? mine[0]?.seller.handle ?? (clean ? `@${clean}` : '@seller')
  const displayName = profile?.displayName ?? mine[0]?.seller.name ?? ''
  const initial = (displayName || display || clean || 'S').replace(/^@+/, '').charAt(0).toUpperCase()
  const color = mine[0]?.seller.color ?? '#4166fb'
  const incomplete = isOwner && (!profile.bio || !walletAddress)
  const totalSpots = mine.reduce((sum, listing) => sum + listing.spots.length, 0)
  const soldSpots = mine.reduce((sum, listing) => sum + listing.spots.filter((spot) => spot.sold || spot.claimedBy || spot.bidBy).length, 0)
  const availableSpots = Math.max(0, totalSpots - soldSpots)

  const startEditing = () => {
    if (!profile) return
    setBioDraft(profile.bio)
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    const toastId = toast.loading('Saving profile', 'Updating your public creator page.')
    try {
      const updated = await updateMyProfile({
        bio: bioDraft,
        ...(walletAddress ? { payoutWallet: walletAddress } : {}),
      })
      setProfile(updated)
      setEditing(false)
      toast.update(toastId, {
        title: 'Profile saved',
        description: 'Your creator profile is up to date.',
        tone: 'success',
      })
    } catch (e) {
      const message = userErrorMessage(e, 'Could not save profile.')
      setSaveError(message)
      toast.update(toastId, {
        title: 'Could not save profile',
        description: message,
        tone: 'error',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <PageShell>
        <Header />
        <main className="mx-auto w-full max-w-[1340px] px-6 pb-16 pt-8">
        <Link href="/browse" className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-[#64748b] transition hover:text-[#020817]">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to browse
        </Link>

        <section className="mb-8 rounded-[28px] border border-[#e7e5e0] bg-white p-5 shadow-[0_18px_60px_rgba(2,8,23,0.06)] sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          {profile?.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatar} alt="" width={80} height={80} className="h-20 w-20 shrink-0 rounded-3xl object-cover" />
          ) : (
            <span
              className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl text-2xl font-semibold text-white"
              style={{ background: color }}
            >
              {initial}
            </span>
          )}
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-3xl">
              {display}
              {profile?.verified && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[#eef2ff] px-2.5 py-1 text-xs font-semibold text-[#4166fb]">
                  <BadgeCheck className="h-3.5 w-3.5" aria-hidden />
                  X verified
                </span>
              )}
            </h1>
            {displayName && displayName.replace(/^@+/, '').toLowerCase() !== display.replace(/^@+/, '').toLowerCase() && (
              <p className="text-[15px] text-[#64748b]">{displayName}</p>
            )}
            {profile ? (
              profile.bio ? (
                <p className="mt-1 max-w-[560px] text-[15px] text-[#020817]/80">{profile.bio}</p>
              ) : (
                <p className="mt-1 text-[15px] text-[#64748b]">{isOwner ? 'Add a bio so buyers know you.' : 'No bio yet.'}</p>
              )
            ) : (
              <p className="mt-1 text-[15px] text-[#64748b]">
                {!hydrated && !profileMissing
                  ? 'Loading spaces...'
                  : mine.length === 0
                    ? profileMissing ? 'No live spaces yet.' : 'Loading profile...'
                    : `${mine.length} live space${mine.length === 1 ? '' : 's'}`}
              </p>
            )}
            {profile && hydrated && (
              <p className="mt-1 text-[13px] text-[#64748b]">
                {mine.length === 0 ? 'No live spaces yet.' : `${mine.length} live space${mine.length === 1 ? '' : 's'}`}
              </p>
            )}
          </div>
          {isOwner && !editing && (
            <span className="flex shrink-0 items-center gap-2 sm:ml-auto">
              <button
                type="button"
                onClick={startEditing}
                className="rounded-full border border-[#e7e5e0] bg-white px-5 py-2.5 text-sm font-medium text-[#020817] transition hover:border-[#c3cdfd]"
              >
                Edit profile
              </button>
              <button
                type="button"
                onClick={() => void logout()}
                className="rounded-full px-4 py-2.5 text-sm font-medium text-[#020817]/60 transition hover:text-[#020817]"
              >
                Log out
              </button>
            </span>
          )}
        </div>
        <div className="mt-6 grid gap-3 border-t border-[#e7e5e0] pt-5 sm:grid-cols-3">
          <ProfileStat label="Live spaces" value={hydrated ? String(mine.length) : '—'} />
          <ProfileStat label="Available spots" value={hydrated ? String(availableSpots) : '—'} />
          <ProfileStat label="Claimed or bid" value={hydrated ? String(soldSpots) : '—'} />
        </div>
        </section>

        {incomplete && !editing && (
          <div className="mb-8 rounded-2xl border border-[#f5d98b] bg-[#fffaeb] p-5">
            <h3 className="text-[15px] font-semibold text-[#020817]">Complete your profile to start selling.</h3>
            <p className="mt-1 text-sm text-[#64748b]">
              {!profile.bio && !walletAddress
                ? 'Add a short bio and finish creating your Privy wallet.'
                : !profile.bio
                  ? 'Add a short bio so buyers know you.'
                  : 'Finish creating your Privy wallet.'}
            </p>
            <button
              type="button"
              onClick={startEditing}
              className="mt-3 inline-flex items-center rounded-full bg-[#020817] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0f1a33]"
            >
              Complete profile
            </button>
          </div>
        )}

        {editing && (
          <div className="mb-8 rounded-2xl border border-[#e7e5e0] bg-white p-5">
            <label className="block text-sm font-medium text-[#020817]">
              Bio
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                maxLength={280}
                rows={3}
                placeholder="What do you put ads on?"
                className="mt-2 block w-full rounded-xl border border-[#e7e5e0] px-4 py-3 text-[15px] outline-none transition focus:border-[#4166fb]"
              />
            </label>
            <p className="mt-1 text-right text-xs text-[#64748b]">{bioDraft.length}/280</p>
            <div className="mt-3 rounded-xl border border-[#e7e5e0] bg-[#f8fafc] px-4 py-3">
              <p className="text-sm font-medium text-[#020817]">Privy Solana wallet</p>
              <p className="mt-1 break-all font-mono text-sm text-[#526079]">
                {walletAddress ?? 'Wallet is being created by Privy'}
              </p>
              <p className="mt-1 text-xs text-[#64748b]">Transactions and withdrawals use this embedded wallet.</p>
            </div>
            {saveError && <p className="mt-3 text-sm text-[#dc2626]">{saveError}</p>}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex items-center rounded-full bg-[#020817] px-6 py-2.5 text-sm font-medium text-white transition hover:bg-[#0f1a33] disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save profile'}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="inline-flex items-center rounded-full border border-[#e7e5e0] bg-white px-6 py-2.5 text-sm font-medium text-[#020817] transition hover:border-[#c3cdfd] disabled:opacity-60"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {isOwner && walletAddress && !editing && (
          <div className="mb-8 rounded-2xl border border-[#e7e5e0] bg-white p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#f3f6ff] text-[#4166fb]">
                <Wallet className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#64748b]">Privy Solana wallet</p>
                <p className="mt-1 break-all font-mono text-sm text-[#020817]">{walletAddress}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between border-t border-[#e7e5e0] pt-4">
              <div className="flex items-start gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-[#4166fb]" aria-hidden />
                <div><p className="text-sm font-medium text-[#020817]">Two-factor authentication</p><p className="text-xs text-[#64748b]">Required for withdrawals</p></div>
              </div>
              {mfaEnabled ? <span className="text-sm font-semibold text-emerald-700">Enabled</span> : <button type="button" onClick={setupMfa} className="rounded-full bg-[#020817] px-4 py-2 text-sm font-medium text-white">Set up MFA</button>}
            </div>
          </div>
        )}

        {!hydrated ? (
          <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center text-sm text-[#64748b]">
            Loading spaces...
          </div>
        ) : mine.length === 0 ? (
          <div className="rounded-2xl border border-[#e7e5e0] bg-white p-12 text-center">
            <h3 className="text-xl">No spaces from {display} yet.</h3>
            <p className="mt-2 text-sm text-[#64748b]">Try another seller or list your own surface.</p>
            <Link href="/browse" className="mt-6 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white transition hover:bg-[#0f1a33]">
              Browse all spaces
            </Link>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {mine.map((listing) => (
              <Link key={listing.id} href={listingUrl(listing, listings)} className="block">
                <ListingCard listing={listing} />
              </Link>
            ))}
          </div>
        )}
      </main>
    </PageShell>
    <Footer />
  </>
)
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#e7e5e0] bg-[#fafaf7] px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#64748b]">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-[#020817]">{value}</p>
    </div>
  )
}
