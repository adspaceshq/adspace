/**
 * Single source of truth for Solana chain settings on the frontend.
 * Mainnet cutover = change env vars, not N scattered fallbacks.
 * (Defaults are devnet; the public RPC default is for local dev only —
 * deployment must set a private RPC URL.)
 */

export const ADSPACES_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'

export const ADSPACES_PROGRAM_ID_STRING =
  process.env.NEXT_PUBLIC_ADSPACES_PROGRAM_ID ?? '8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5'

export const SOLANA_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'

export function explorerTxUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`
  return ADSPACES_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${ADSPACES_CLUSTER}`
}

export function explorerAddressUrl(address: string): string {
  const base = `https://explorer.solana.com/address/${address}`
  return ADSPACES_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${encodeURIComponent(ADSPACES_CLUSTER)}`
}
