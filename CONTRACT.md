# Spotboard API contract (v1, mock money)

Base URL: `NEXT_PUBLIC_API_URL` (local default `http://localhost:8080`).
All bodies/returns are JSON. Errors: `{ "error": string }`.
Cookie: `spotboard_sid` (httpOnly, expiring, secure in production). Authenticated mutations require the session-bound `X-CSRF-Token` returned by the session endpoints.

## Auth

X login: Privy OAuth in the browser, then the access token is exchanged here.

| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/api/auth/session` | Bearer Privy access token | `SessionResponse` + Set-Cookie |
| GET | `/api/auth/me` | cookie | `SessionResponse` |
| POST | `/api/auth/logout` | cookie + CSRF | `{ ok: true }` |

`SessionUser = { id, did, handle, name?, avatar? }`. `id` is Spotboard's stable user ID. The immutable Privy DID and X subject are stored server-side; `handle` is mutable profile data. `SessionResponse` adds `{ csrfToken, expiresAt }`.

List/claim/bid **require** a session. Seller/buyer/bidder is always `req.user.handle` — never the request body.

## Listings

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/health` | — | — | `{ status: "ok", auth: "privy" \| "unconfigured" }` |
| GET | `/api/listings` | public | — | `ListingSummary[]` |
| GET | `/api/listings/{slug}` | public | — | `Listing` (with `spots`) |
| POST | `/api/listings` | required | `{ title, surface?, story?, mode?, currency?, artworkClose?, spots?: [{ label?, location?, size?, price }] }` | `Listing` (201) |
| POST | `/api/spots/{id}/claim` | required | — | `Spot` |
| POST | `/api/spots/{id}/bid` | required | `{ amount }` | `Spot` |

## Rules

- `mode: "fixed"` → claim open spots. Auction spots reject claims (409).
- `mode: "auction"` → bid only. First bid ≥ starting `price`. Later bids must beat current by `minIncrement` (Vincent: 10 EUR). If `doubleUp: true` (Marc), each takeover doubles.
- Claiming/bidding a non-open spot → 409.
- Max 60 spots. Every spot price must be > 0.

## Types

See `backend/src/types.ts` and `frontend/src/lib/types.ts`.
