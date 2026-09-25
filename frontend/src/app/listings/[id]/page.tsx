'use client'

import { use, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import ListingDetailView from '@/components/ListingDetailView'
import { useStore } from '@/components/StoreProvider'
import { listingUrl } from '@/lib/listings'

export default function ListingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { listings, hydrated } = useStore()
  const router = useRouter()

  const found = listings.find((l) => l.id === id)

  // Canonical URL is /:handle/mac — old /listings/:slug links land here and move over.
  useEffect(() => {
    if (hydrated && found) router.replace(listingUrl(found, listings))
  }, [hydrated, found, listings, router])

  return <ListingDetailView id={id} />
}
