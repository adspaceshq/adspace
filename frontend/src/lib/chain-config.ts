/**
 * Single source of truth for Solana chain settings on the frontend.
 * Mainnet cutover = change env vars, not N scattered fallbacks.
 * (Defaults are devnet. There is deliberately no RPC URL here: the browser
 * makes no RPC calls, so the paid RPC key lives only on the backend.)
 */

export const ADSPACES_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet'

export const ADSPACES_PROGRAM_ID_STRING =
  process.env.NEXT_PUBLIC_ADSPACES_PROGRAM_ID ?? '8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5'

export function explorerTxUrl(signature: string): string {
  const base = `https://explorer.solana.com/tx/${signature}`
  return ADSPACES_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${ADSPACES_CLUSTER}`
}

export function explorerAddressUrl(address: string): string {
  const base = `https://explorer.solana.com/address/${address}`
  return ADSPACES_CLUSTER === 'mainnet-beta' ? base : `${base}?cluster=${encodeURIComponent(ADSPACES_CLUSTER)}`
}
