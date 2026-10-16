import { describe, expect, it } from 'vitest'
import { ApiError } from './api/v2'
import { CLOCK_SKEW_MESSAGE, GENERIC_MESSAGE, isNotFound, NETWORK_MESSAGE, PAUSED_MESSAGE, SERVER_MESSAGE, userErrorMessage } from './errors'

describe('userErrorMessage', () => {
  it('explains Privy clock-skew rejections', () => {
    expect(userErrorMessage(new Error('Invalid privy-request-expiry header'))).toBe(CLOCK_SKEW_MESSAGE)
    expect(userErrorMessage(new Error('Request has expired'))).toBe(CLOCK_SKEW_MESSAGE)
    // Privy sometimes throws plain objects rather than Errors.
    expect(userErrorMessage({ message: 'the request has expired' })).toBe(CLOCK_SKEW_MESSAGE)
  })

  it('keeps readable messages and falls back for unknown values', () => {
    expect(userErrorMessage(new Error('not enough USDC in your wallet'))).toBe('not enough USDC in your wallet')
    expect(userErrorMessage(new ApiError('this spot has already been taken', 409))).toBe('this spot has already been taken')
    expect(userErrorMessage(new ApiError('verify your email first', 403))).toBe('verify your email first')
    expect(userErrorMessage('nope', 'fallback')).toBe('fallback')
    expect(userErrorMessage(undefined)).toBe(GENERIC_MESSAGE)
  })

  it('never shows developer copy for network failures', () => {
    const message = userErrorMessage(new TypeError('Failed to fetch'))
    expect(message).toBe(NETWORK_MESSAGE)
    expect(message).not.toMatch(/backend/i)
    expect(userErrorMessage(new TypeError('Load failed'))).toBe(NETWORK_MESSAGE)
  })

  it('maps known server messages to product copy', () => {
    expect(userErrorMessage(new ApiError('spot changed while the claim was confirming; reconciling', 500))).toMatch(/still settling/)
    expect(userErrorMessage(new ApiError('vault is empty; reconciling', 409))).toMatch(/still settling/)
    expect(userErrorMessage(new ApiError('refund with your listing wallet', 409))).toMatch(/wallet that published/)
    expect(userErrorMessage(new ApiError('already waiting for multisig approval (Squads #4)', 409))).toBe('this decision is already waiting for multisig approval.')
    expect(userErrorMessage(new ApiError('Protocol is paused.', 409))).toBe(PAUSED_MESSAGE)
    expect(userErrorMessage(new ApiError('trading is paused', 409))).toBe(PAUSED_MESSAGE)
    expect(userErrorMessage(new ApiError('invalid CSRF token', 403))).toMatch(/session expired/)
    expect(userErrorMessage(new Error('That service is unavailable'))).not.toMatch(/environment/)
  })

  it('uses status defaults where the server text is missing or internal', () => {
    expect(userErrorMessage(new ApiError('sign in required', 401))).toBe('sign in again to continue.')
    expect(userErrorMessage(new ApiError('something went wrong', 500))).toBe(SERVER_MESSAGE)
    expect(userErrorMessage(new ApiError('request failed (502)', 502))).toBe(SERVER_MESSAGE)
    expect(userErrorMessage(new ApiError('request failed (404)', 404))).toMatch(/couldn't find/)
    expect(userErrorMessage(new ApiError('Too many requests', 429))).toMatch(/too many tries/)
    expect(userErrorMessage(new ApiError('TypeError: cannot read properties of undefined (reading "x")', 400))).toBe(GENERIC_MESSAGE)
  })

  it('hides stack traces and dumps from plain errors', () => {
    expect(userErrorMessage(new Error('Error: boom\n    at foo (bar.js:1:2)'))).toBe(GENERIC_MESSAGE)
    expect(userErrorMessage(new Error('{"code":-32002,"message":"Transaction simulation failed"}'))).toBe(GENERIC_MESSAGE)
    expect(userErrorMessage(new SyntaxError('Unexpected token < in JSON'))).toBe(GENERIC_MESSAGE)
  })

  it('tells not-found apart from other failures', () => {
    expect(isNotFound(new ApiError('listing not found', 404))).toBe(true)
    expect(isNotFound(new ApiError('something went wrong', 500))).toBe(false)
    expect(isNotFound(new TypeError('Failed to fetch'))).toBe(false)
  })
})
