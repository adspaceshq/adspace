'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { listings as seed, type Bid, type Listing } from '@/lib/listings'
import { apiPost } from '@/lib/auth-api'

interface StoreValue {
  listings: Listing[]
  claims: Record<string, string>
  claimSpot: (listingId: string, spotId: string, name: string) => Promise<void>
  placeBid: (listingId: string, spotId: string, bidder: string, amount: number) => Promise<void>
  addListing: (listing: Listing) => Promise<void>
  getListing: (id: string) => Listing | undefined
  hydrated: boolean
}

const StoreContext = createContext<StoreValue | null>(null)

const CLAIMS_KEY = 'spotboard-claims-v3'
const BIDS_KEY = 'spotboard-bids-v3'

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  const [listings, setListings] = useState<Listing[]>(seed)
  const [claims, setClaims] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const savedClaims = localStorage.getItem(CLAIMS_KEY)
      const savedBids = localStorage.getItem(BIDS_KEY)
      const parsedClaims: Record<string, string> = savedClaims ? JSON.parse(savedClaims) : {}
      const parsedBids: Record<string, Bid[]> = savedBids ? JSON.parse(savedBids) : {}
      if (Object.keys(parsedClaims).length > 0 || Object.keys(parsedBids).length > 0) {
        setClaims(parsedClaims)
        setListings((prev) =>
          prev.map((l) => ({
            ...l,
            spots: l.spots.map((s) => {
              const key = `${l.id}:${s.id}`
              const history = parsedBids[key] ?? s.bids ?? []
              const top = history[history.length - 1]
              return {
                ...s,
                claimedBy: parsedClaims[key] || s.claimedBy,
                bids: history,
                bid: top ? top.amount : s.bid,
                bidBy: top ? top.bidder : s.bidBy,
              }
            }),
          }))
        )
      }
    } catch {
      // corrupted storage: fall back to seed
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims))
    } catch {
      // storage blocked: demo still works in memory
    }
  }, [claims, hydrated])

  const persistBid = (listingId: string, spotId: string, entry: Bid) => {
    try {
      const raw = localStorage.getItem(BIDS_KEY)
      const parsed: Record<string, Bid[]> = raw ? JSON.parse(raw) : {}
      const key = `${listingId}:${spotId}`
      parsed[key] = [...(parsed[key] ?? []), entry]
      localStorage.setItem(BIDS_KEY, JSON.stringify(parsed))
    } catch {
      // ignore
    }
  }

  // Mutations POST to the Express API first (apiPost attaches the Privy
  // access token, so the backend attributes the verified X identity when
  // logged in). The API schema differs from this local mock shape, so the
  // POST is best-effort sync: failures fall through and the local update
  // below still applies, keeping the demo working offline / logged out.
  const claimSpot = async (listingId: string, spotId: string, name: string) => {
    try {
      await apiPost(`/api/spots/${spotId}/claim`, { buyer: name });
    } catch {
      // backend unreachable or id not in API store — local fallback below
    }
    setListings((prev) =>
      prev.map((l) =>
        l.id === listingId
          ? {
              ...l,
              spots: l.spots.map((s) =>
                s.id === spotId ? { ...s, claimedBy: name } : s
              ),
            }
          : l
      )
    )
    setClaims((prev) => ({ ...prev, [`${listingId}:${spotId}`]: name }))
  }

  const placeBid = async (listingId: string, spotId: string, bidder: string, amount: number) => {
    try {
      await apiPost(`/api/spots/${spotId}/bid`, { bidder, amount });
    } catch {
      // backend unreachable or id not in API store — local fallback below
    }
    const entry: Bid = { bidder, amount, at: new Date().toISOString() }
    setListings((prev) =>
      prev.map((l) =>
        l.id === listingId
          ? {
              ...l,
              spots: l.spots.map((s) =>
                s.id === spotId ? { ...s, bid: amount, bidBy: bidder, bids: [...(s.bids ?? []), entry] } : s
              ),
            }
          : l
      )
    )
    persistBid(listingId, spotId, entry)
  }

  const addListing = async (listing: Listing) => {
    try {
      await apiPost('/api/listings', {
        title: listing.title,
        seller: listing.seller.name,
        surface: listing.surface,
        story: listing.description,
        mode: listing.priceType,
      });
    } catch {
      // backend unreachable — local fallback below
    }
    setListings((prev) => [listing, ...prev])
  }

  const getListing = (id: string) => listings.find((l) => l.id === id)

  return (
    <StoreContext.Provider value={{ listings, claims, claimSpot, placeBid, addListing, getListing, hydrated }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
