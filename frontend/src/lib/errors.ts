// Turns a thrown error into a sentence for the user. v2 ApiErrors carry the server's message,
// so they fall through to the Error branch.
export function userErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof TypeError && error.message.toLowerCase().includes('fetch')) {
    return 'Could not reach the API. Check that the backend is running and try again.'
  }

  if (error instanceof Error) {
    if (error.message === 'internal error') return 'The server had trouble completing that request. Try again in a moment.'
    if (error.message.toLowerCase().includes('unavailable')) return 'That service is not available in this environment yet.'
    return error.message || fallback
  }

  return fallback
}
