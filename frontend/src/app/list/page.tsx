'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import ListingStudio from '@/components/ListingStudio'

export default function ListPage() {
  return (
    <Suspense>
      <ListRedirect />
    </Suspense>
  )
}

function ListRedirect() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const surface = searchParams.get('surface')

  useEffect(() => {
    if (surface === 'apparel') {
      router.replace('/list/tshirt')
    } else {
      router.replace('/list/mac')
    }
  }, [router, surface])
  return <ListingStudio surface={surface === 'apparel' ? 'apparel' : 'gear'} />
}
