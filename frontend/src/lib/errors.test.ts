import { describe, expect, it } from 'vitest'
import { CLOCK_SKEW_MESSAGE, userErrorMessage } from './errors'

describe('userErrorMessage', () => {
  it('explains Privy clock-skew rejections', () => {
    expect(userErrorMessage(new Error('Invalid privy-request-expiry header'))).toBe(CLOCK_SKEW_MESSAGE)
    expect(userErrorMessage(new Error('Request has expired'))).toBe(CLOCK_SKEW_MESSAGE)
    // Privy sometimes throws plain objects rather than Errors.
    expect(userErrorMessage({ message: 'the request has expired' })).toBe(CLOCK_SKEW_MESSAGE)
  })

  it('keeps other messages and falls back for unknown values', () => {
    expect(userErrorMessage(new Error('not enough USDC in your wallet'))).toBe('not enough USDC in your wallet')
    expect(userErrorMessage('nope', 'fallback')).toBe('fallback')
  })
})
