'use client'

import { use, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import PageShell from '@/components/PageShell'
import ListingDetailView from '@/components/ListingDetailView'
import { useStore } from '@/components/StoreProvider'
import { listingShortKey, resolveNestedListing, sellerUrl } from '@/lib/listings'

export default function NestedListingPage({
  params,
}: {
  params: Promise<{ handle: string; listing: string }>
}) {
  const { handle, listing: listingParam } = use(params)
  const { listings, hydrated } = useStore()
  const router = useRouter()
  const clean = decodeURIComponent(handle ?? '').trim().replace(/^@+/, '')

  const found = resolveNestedListing(listings, handle, listingParam)

  // Long slugs resolve but always settle on the short canonical URL (/notcodesid/mac).
  useEffect(() => {
    if (hydrated && found) {
      const shortKey = listingShortKey(found, listings)
      const current = decodeURIComponent(listingParam ?? '').trim().toLowerCase()
      if (current !== shortKey) router.replace(`${sellerUrl(clean)}/${shortKey}`)
    }
  }, [hydrated, found, listings, listingParam, clean, router])

  if (found) {
    return <ListingDetailView id={found.id} backHref={sellerUrl(clean)} />
  }

  if (!hydrated) {
    return (
      <>
        <PageShell>
          <Header />
          <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
            <p className="text-[#64748b]">Loading space…</p>
          </main>
        </PageShell>
        <Footer />
      </>
    )
  }

  return (
    <>
      <PageShell>
        <Header />
        <main className="mx-auto flex w-full max-w-[1340px] flex-col items-center gap-4 px-6 py-20 text-center">
          <h1 className="text-4xl">Space not found.</h1>
          <p className="text-[#64748b]">This listing does not exist or was removed.</p>
          <Link href={sellerUrl(clean)} className="mt-2 inline-flex items-center rounded-full bg-[#020817] px-6 py-3 text-sm font-medium text-white">
            Back to @{clean}
          </Link>
        </main>
      </PageShell>
      <Footer />
    </>
  )
}
