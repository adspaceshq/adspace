import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TERMS_VERSION } from './terms'

// The backend's TERMS_VERSION is the source of truth: it refuses claims, bids and onboarding that
// send any other version. The app sends this constant, so the two must match before shipping.
describe('TERMS_VERSION', () => {
  it('matches the backend', () => {
    const backend = readFileSync(fileURLToPath(new URL('../../../backend/src/types.ts', import.meta.url)), 'utf8')
    const match = /export const TERMS_VERSION = "([^"]+)"/.exec(backend)
    expect(match?.[1]).toBeDefined()
    expect(TERMS_VERSION).toBe(match![1])
  })
})
