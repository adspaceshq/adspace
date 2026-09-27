'use client'

import { useState } from 'react'
import { sellerUsername } from '@/lib/listings'

// X profile picture with an initial-circle fallback. unavatar is a mock-grade
// avatar proxy (BrandMyMac uses the same); a proper avatar comes with Privy
// profile data once the API returns it.
export default function SellerAvatar({
  seller,
  className = 'h-6 w-6 text-xs',
}: {
  seller: { name: string; handle: string; color: string }
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const username = sellerUsername(seller)
  if (!failed && username) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`https://unavatar.io/x/${encodeURIComponent(username)}`} alt="" loading="lazy" onError={() => setFailed(true)} className={`${className} shrink-0 rounded-full object-cover`} />
  }
  return (
    <span className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`} style={{ background: seller.color }}>
      {(seller.name || username || 'S').charAt(0).toUpperCase()}
    </span>
  )
}
