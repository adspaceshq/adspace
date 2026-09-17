'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  apiListingToUi,
  applyApiSpotToUi,
  listings as seed,
  remapMockupIds,
  type Bid,
  type Listing,
} from '@/lib/listings'
import {
  bidApiSpot,
  claimApiSpot,
  createApiListing,
  fetchListing,
  fetchListingSummaries,
} from '@/lib/auth-api'

interface StoreValue {
  listings: Listing[]
  claims: Record<string, string>
  claimSpot: (listingId: string, spotId: string, name: string) => Promise<void>
  placeBid: (listingId: string, spotId: string, bidder: string, amount: number) => Promise<void>
  addListing: (listing: Listing) => Promise<string>
  getListing: (id: string) => Listing | undefined
  hydrated: boolean
  live: boolean
}

const StoreContext = createContext<StoreValue | null>(null)

const CLAIMS_KEY = 'spotboard-claims-v3'
const BIDS_KEY = 'spotboard-bids-v3'

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError
}

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  const [listings, setListings] = useState<Listing[]>(seed)
  const [claims, setClaims] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)
  const [live, setLive] = useState(false)
  const apiIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    const hydrateLocal = () => {
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
            })),
          )
        }
      } catch {
        // corrupted storage
      }
    }
    ;(async () => {
      try {
        const summaries = await fetchListingSummaries()
        const full = await Promise.all(summaries.map((s) => fetchListing(s.slug)))
        if (!cancelled && full.length > 0) {
          apiIds.current = new Set(full.map((l) => l.slug))
          setListings(full.map(apiListingToUi))
          setLive(true)
        } else if (!cancelled) {
          hydrateLocal()
        }
      } catch {
        if (!cancelled) hydrateLocal()
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(CLAIMS_KEY, JSON.stringify(claims))
    } catch {
      // ignore
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

  const applyLocalClaim = (listingId: string, spotId: string, name: string) => {
    setListings((prev) =>
      prev.map((l) =>
        l.id === listingId
          ? { ...l, spots: l.spots.map((s) => (s.id === spotId ? { ...s, claimedBy: name } : s)) }
          : l,
      ),
    )
    setClaims((prev) => ({ ...prev, [`${listingId}:${spotId}`]: name }))
  }

  const applyLocalBid = (listingId: string, spotId: string, bidder: string, amount: number) => {
    const entry: Bid = { bidder, amount, at: new Date().toISOString() }
    setListings((prev) =>
      prev.map((l) =>
        l.id === listingId
          ? {
              ...l,
              spots: l.spots.map((s) =>
                s.id === spotId ? { ...s, bid: amount, bidBy: bidder, bids: [...(s.bids ?? []), entry] } : s,
              ),
            }
          : l,
      ),
    )
    persistBid(listingId, spotId, entry)
  }

  const claimSpot = async (listingId: string, spotId: string, name: string) => {
    if (apiIds.current.has(listingId) || live) {
      try {
        const updated = await claimApiSpot(spotId)
        const buyer = updated.buyer ?? name
        setListings((prev) =>
          prev.map((l) =>
            l.id === listingId
              ? {
                  ...l,
                  spots: l.spots.map((s) =>
                    s.id === spotId ? applyApiSpotToUi(s, updated, l.priceType) : s,
                  ),
                }
              : l,
          ),
        )
        setClaims((prev) => ({ ...prev, [`${listingId}:${spotId}`]: buyer }))
        return
      } catch (e) {
        if (!isNetworkError(e)) throw e
      }
    }
    applyLocalClaim(listingId, spotId, name)
  }

  const placeBid = async (listingId: string, spotId: string, bidder: string, amount: number) => {
    if (apiIds.current.has(listingId) || live) {
      try {
        const updated = await bidApiSpot(spotId, amount)
        const entry: Bid = {
          bidder: updated.buyer ?? bidder,
          amount: updated.currentBid ?? amount,
          at: new Date().toISOString(),
        }
        setListings((prev) =>
          prev.map((l) =>
            l.id === listingId
              ? {
                  ...l,
                  spots: l.spots.map((s) =>
                    s.id === spotId ? applyApiSpotToUi(s, updated, l.priceType) : s,
                  ),
                }
              : l,
          ),
        )
        persistBid(listingId, spotId, entry)
        return
      } catch (e) {
        if (!isNetworkError(e)) throw e
      }
    }
    applyLocalBid(listingId, spotId, bidder, amount)
  }

  const addListing = async (listing: Listing): Promise<string> => {
    try {
      const api = await createApiListing({
        title: listing.title,
        surface: listing.surface,
        story: listing.description,
        mode: listing.priceType,
        currency: listing.currency ?? 'USD',
        spots: listing.spots.map((s) => ({
          label: s.label,
          location: s.location,
          size: s.size,
          price: s.price,
        })),
      })
      const idMap = new Map(listing.spots.map((s, i) => [s.id, api.spots[i]?.id ?? s.id] as const))
      const adopted: Listing = {
        ...apiListingToUi(api),
        mockup: remapMockupIds(listing.mockup, idMap),
      }
      apiIds.current.add(adopted.id)
      setListings((prev) => [adopted, ...prev])
      return adopted.id
    } catch (e) {
      if (!isNetworkError(e)) throw e
    }
    setListings((prev) => [listing, ...prev])
    return listing.id
  }

  const getListing = (id: string) => listings.find((l) => l.id === id)

  return (
    <StoreContext.Provider value={{ listings, claims, claimSpot, placeBid, addListing, getListing, hydrated, live }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used within StoreProvider')
  return ctx
}
