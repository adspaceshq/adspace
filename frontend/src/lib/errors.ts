import { ApiError } from './auth-api'

export function userErrorMessage(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Your session expired. Log in again to continue.'
    if (error.status === 403) return 'You do not have permission to do that.'
    if (error.status === 404) return 'We could not find that record. It may have been removed.'
    if (error.status === 409) return error.message || 'That action is not available right now.'
    if (error.status === 429) return 'Too many attempts. Wait a moment and try again.'
    if (error.status >= 500) return 'The server had trouble completing that request. Try again in a moment.'
    return error.message || fallback
  }

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
