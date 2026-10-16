// Privy rejects signing requests whose timestamp is off from its servers', which happens when the
// device clock is wrong. Its message ("privy-request-expiry", "request has expired") means nothing to users.
const CLOCK_SKEW = /privy-request-expiry|request has expired/i
export const CLOCK_SKEW_MESSAGE = 'your device clock is off. turn on automatic date and time, then try again.'

// Turns a thrown error into a sentence for the user. v2 ApiErrors carry the server's message,
// so they fall through to the Error branch.
export function userErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  const message = typeof (error as { message?: unknown } | null)?.message === 'string' ? (error as { message: string }).message : ''
  if (CLOCK_SKEW.test(message)) return CLOCK_SKEW_MESSAGE

  if (error instanceof TypeError && message.toLowerCase().includes('fetch')) {
    return 'Could not reach the API. Check that the backend is running and try again.'
  }

  if (error instanceof Error) {
    if (message === 'internal error') return 'The server had trouble completing that request. Try again in a moment.'
    if (message.toLowerCase().includes('unavailable')) return 'That service is not available in this environment yet.'
    return message || fallback
  }

  return fallback
}
