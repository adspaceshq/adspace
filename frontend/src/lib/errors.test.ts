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

  it('maps the new program errors (6049-6052) and keeps the proof and approval rules readable', () => {
    expect(userErrorMessage(new ApiError("Only the review authority can pay a listing's rent.", 409))).toMatch(/platform setup problem/)
    expect(userErrorMessage(new ApiError('Artwork window is still open; proof is accepted from artwork close.', 409))).toMatch(/proof opens when the artwork window closes/)
    expect(userErrorMessage(new ApiError('Dispute timeout has passed; only the timeout refund remains.', 409))).toMatch(/timed out, so it can't be resolved/)
    expect(userErrorMessage(new ApiError('The current top bidder cannot outbid itself.', 409))).toBe("you're already the top bidder.")
    expect(userErrorMessage(new ApiError("you're already the top bidder", 409))).toBe("you're already the top bidder.")
    expect(userErrorMessage(new ApiError('only 5h 2m left before this dispute times out at 2026-10-20T10:00:00.000Z; a multisig proposal needs at least 6 hours to be approved and executed, so let it time out (full refund to the sponsor)', 409))).toMatch(/too little time is left/)
    expect(userErrorMessage(new ApiError('proof opens at oct 16, 21:37 utc, when the artwork window closes', 409))).toBe('proof opens at oct 16, 21:37 utc, when the artwork window closes')
    expect(userErrorMessage(new ApiError('listings longer than 90 days need an admin to approve', 403))).toBe('listings longer than 90 days need an admin to approve')
  })

  it('maps the second-scan program errors (6053-6054)', () => {
    expect(userErrorMessage(new ApiError('The dispute does not match the one this resolution was decided for.', 409))).toMatch(/earlier dispute on this spot/)
    expect(userErrorMessage(new ApiError('this decision was made for an earlier dispute on this spot (it was withdrawn or raised again); review the current dispute and decide again', 409))).toMatch(/decide again/)
    expect(userErrorMessage(new ApiError('The vault holds funds; pass the seller token account to sweep them.', 409))).toMatch(/creator's token account/)
  })

  it('explains reviewer key rotation errors', () => {
    const key = '8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5'
    expect(userErrorMessage(new ApiError(`this listing's rent payer is ${key}, not the server key ${key}; adopt listings in ops first (after a reviewer key rotation)`, 409))).toMatch(/adopt listings in ops first, then close it/)
    expect(userErrorMessage(new ApiError(`the server's reviewer key ${key} is not the on-chain review authority ${key}; rotate the review authority to it first`, 409))).toMatch(/rotate the review authority/)
    expect(userErrorMessage(new ApiError("this dispute has timed out, so it can't be withdrawn anymore. take the full refund instead", 409))).toMatch(/can't be withdrawn anymore/)
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
