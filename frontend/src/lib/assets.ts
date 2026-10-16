/**
 * Preset (non-uploaded) imagery: Mac photos, tee preview, landing art.
 *
 * Single source of truth for where these bytes live. They are served from
 * the `adspaces-static` Cloudflare R2 bucket (public r2.dev URL below, or
 * override with `NEXT_PUBLIC_STATIC_ASSET_BASE` for a custom domain).
 * Files live under `/adspaces/static/...` in the bucket.
 */

const STATIC_BASE = (process.env.NEXT_PUBLIC_STATIC_ASSET_BASE ?? '').trim().replace(/\/+$/, '')
  || 'https://pub-2482b5a7819649d091505270c0d675aa.r2.dev'

const preset = (path: string): string => `${STATIC_BASE}${path}`

// --- Mac surface (gear listings) ---
export const MAC_LID_PHOTO = preset('/adspaces/static/mac/macbook.png')
export const MAC_INSIDE_PHOTO = preset('/adspaces/static/mac/mac-inside.png')

// --- T-shirt surface preview (shares the hero-2 shot) ---
export const TEE_PREVIEW_IMAGE = preset('/adspaces/static/landing/hero-2.png')

// --- Landing page ---
export const HERO_IMAGE_1 = preset('/adspaces/static/landing/hero-1.png')
export const HERO_IMAGE_2 = preset('/adspaces/static/landing/hero-2.png')
export const HERO_IMAGE_3 = preset('/adspaces/static/landing/hero-3.png')
