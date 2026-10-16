// The one place thrown errors become words for users. Every user-facing error goes through
// userErrorMessage: known server and wallet messages get product copy, statuses get a sensible
// default, and anything that looks internal (stack traces, long dumps, developer text) never shows.

// Privy rejects signing requests whose timestamp is off from its servers', which happens when the
// device clock is wrong. Its message ("privy-request-expiry", "request has expired") means nothing to users.
const CLOCK_SKEW = /privy-request-expiry|request has expired/i
export const CLOCK_SKEW_MESSAGE = 'your device clock is off. turn on automatic date and time, then try again.'

export const NETWORK_MESSAGE = "couldn't reach adspaces. check your connection and try again."
export const SERVER_MESSAGE = 'adspaces had trouble with that. try again in a minute.'
export const PAUSED_MESSAGE = 'trading is paused right now. payouts, refunds and disputes still work.'
export const GENERIC_MESSAGE = 'something went wrong. try again.'

// Server and program messages that are accurate but not written for users. First match wins.
const KNOWN: Array<[RegExp, string]> = [
  [/protocol ?paused|protocol is paused|trading is paused/i, PAUSED_MESSAGE],
  [/; reconciling$|reconciling/i, "this is still settling on solana. refresh in a minute to see the latest state; your funds are safe."],
  [/vault is empty/i, "this spot's escrow is already settled. refresh to see the latest state."],
  [/refund with your listing wallet/i, 'refunds have to be signed by the wallet that published this listing. sign in with that account and try again.'],
  [/already waiting for multisig approval/i, 'this decision is already waiting for multisig approval.'],
  [/invalid csrf token/i, 'your session expired. refresh the page and try again.'],
  [/^sign in required$|^missing access token$/i, 'sign in again to continue.'],
  [/on-chain actions are not configured/i, "payments aren't available right now. try again later."],
  [/network took too long|blockhash not found/i, 'solana is busy right now. nothing was charged; try again in a moment.'],
  [/transaction failed on solana/i, "the transaction didn't go through on solana. nothing was charged; try again."],
  [/^something went wrong$|^internal error$/i, SERVER_MESSAGE],
  [/^request failed \(\d+\)$/i, ''],
  [/unavailable/i, "that isn't available right now. try again later."],
]

// Text that reads like code or a dump rather than a sentence.
function looksInternal(message: string): boolean {
  return (
    message.length > 180 ||
    /\n|\s+at\s+\S+\s*\(|^\w*Error:|\{|\}|0x[0-9a-f]{4,}|https?:\/\/|stack|undefined|null\b|ECONN|ETIMEDOUT/i.test(message)
  )
}

function statusMessage(status: number): string | undefined {
  if (status === 401) return 'sign in again to continue.'
  if (status === 403) return "you don't have access to that."
  if (status === 404) return "we couldn't find that. it may have been removed."
  if (status === 413) return 'that file is too large.'
  if (status === 429) return 'too many tries. wait a minute and try again.'
  if (status >= 500) return SERVER_MESSAGE
  return undefined
}

// Turns a thrown error into a sentence for the user. v2 ApiErrors carry the server's message and status.
export function userErrorMessage(error: unknown, fallback = GENERIC_MESSAGE): string {
  const raw = typeof (error as { message?: unknown } | null)?.message === 'string' ? (error as { message: string }).message.trim() : ''
  const status = typeof (error as { status?: unknown } | null)?.status === 'number' ? (error as { status: number }).status : undefined

  if (CLOCK_SKEW.test(raw)) return CLOCK_SKEW_MESSAGE
  // fetch() rejects with a TypeError when the network or CORS fails ("Failed to fetch", "Load failed").
  if (error instanceof TypeError && /fetch|network|load failed/i.test(raw)) return NETWORK_MESSAGE

  for (const [pattern, copy] of KNOWN) if (pattern.test(raw)) return copy || (status ? (statusMessage(status) ?? fallback) : fallback)

  if (status !== undefined) {
    // 401, 429 and server errors get fixed copy; other client errors carry the server's own sentence.
    if (status === 401 || status === 429 || status >= 500) return statusMessage(status)!
    if (raw && !looksInternal(raw)) return raw
    return statusMessage(status) ?? fallback
  }

  if (error instanceof Error && raw && !looksInternal(raw) && !(error instanceof SyntaxError)) return raw
  return fallback
}

// For views that branch on "not there" vs "couldn't load" (a 404 shouldn't offer a retry).
export function isNotFound(error: unknown): boolean {
  return (error as { status?: unknown } | null)?.status === 404
}
