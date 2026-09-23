'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  apiListingToUi,
  applyApiSpotToUi,
  remapMockupIds,
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

export default function StoreProvider({ children }: { children: React.ReactNode }) {
  const [listings, setListings] = useState<Listing[]>([])
  const [claims, setClaims] = useState<Record<string, string>>({})
  const [hydrated, setHydrated] = useState(false)
  const [live, setLive] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const summaries = await fetchListingSummaries()
        const full = await Promise.all(summaries.map((s) => fetchListing(s.slug)))
        if (!cancelled) {
          setListings(full.map(apiListingToUi))
          setLive(true)
        }
      } catch {
        if (!cancelled) {
          setListings([])
          setLive(false)
        }
      } finally {
        if (!cancelled) setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const claimSpot = async (listingId: string, spotId: string, name: string) => {
    const updated = await claimApiSpot(spotId)
    const buyer = updated.buyer ?? name
    setListings((prev) => prev.map((l) => l.id === listingId
      ? { ...l, spots: l.spots.map((s) => s.id === spotId ? applyApiSpotToUi(s, updated, l.priceType) : s) }
      : l))
    setClaims((prev) => ({ ...prev, [`${listingId}:${spotId}`]: buyer }))
  }

  const placeBid = async (listingId: string, spotId: string, bidder: string, amount: number) => {
    void bidder
    const updated = await bidApiSpot(spotId, amount)
    setListings((prev) => prev.map((l) => l.id === listingId
      ? { ...l, spots: l.spots.map((s) => s.id === spotId ? applyApiSpotToUi(s, updated, l.priceType) : s) }
      : l))
  }

  const addListing = async (listing: Listing): Promise<string> => {
    const api = await createApiListing({
        title: listing.title,
        surface: listing.surface,
        story: listing.description,
        mode: listing.priceType,
        currency: listing.currency ?? 'USD',
        deadline: listing.endsAt,
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
    setListings((prev) => [adopted, ...prev])
    return adopted.id
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
