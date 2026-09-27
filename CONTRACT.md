# Adspaces API contract (v1, mock money)

Base URL: `NEXT_PUBLIC_API_URL` (local default `http://localhost:8080`).
All bodies/returns are JSON. Errors: `{ "error": string }`.
Cookie: `adspaces_sid` (httpOnly, expiring, secure in production). Authenticated mutations require the session-bound `X-CSRF-Token` returned by the session endpoints.

## Auth

X login: Privy OAuth in the browser, then the access token is exchanged here.

| Method | Path | Auth | Returns |
|---|---|---|---|
| POST | `/api/auth/session` | Bearer Privy access token | `SessionResponse` + Set-Cookie |
| GET | `/api/auth/me` | cookie | `SessionResponse` |
| POST | `/api/auth/logout` | cookie + CSRF | `{ ok: true }` |

`SessionUser = { id, did, handle, name?, avatar? }`. `id` is Adspaces' stable user ID. The immutable Privy DID and X subject are stored server-side; `handle` is mutable profile data. `SessionResponse` adds `{ csrfToken, expiresAt }`.

List/claim/bid **require** a session. Seller/buyer/bidder is always `req.user.handle` — never the request body.

## Profiles (Step 1: Create profile)

Every X login auto-creates the `users` row, so `3000/{username}` resolves even
with zero listings. The profile is public; editing is owner-only.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/users/{handle}` | public | — | `Profile` (404 if unknown) |
| PATCH | `/api/users/me` | required + CSRF | `{ bio?, payoutWallet? }` | `Profile` |

`Profile = { id, handle, displayName?, avatar?, bio, payoutWallet?, verified }`.
`handle` lookup is case-insensitive with a leading `@` optional. `verified`
is true while the account is X-linked (the API 422s without a stable X
identity, so there is no separate KYC step yet). `payoutWallet` is returned
only to the owner — other viewers see it omitted. Validation: `bio` at most
280 chars; `payoutWallet` empty (clear) or a Solana base58 address (32–44
chars), anything else → 400. Unknown body fields are ignored. Ownership
compares stable user IDs, never X handles.

## Listings

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/health` | — | — | `{ status: "ok", auth: "privy" \| "unconfigured", sessions: "postgres", chain: { cluster, programId, integration: "pending-idl" } }` |
| GET | `/api/listings` | public | — | `ListingSummary[]` |
| GET | `/api/listings/{slug}` | public | — | `Listing` (with `spots`) |
| GET | `/api/seller/dashboard` | required | — | `SellerDashboard` |
| POST | `/api/listings` | required | `{ title, surface?, story?, fabric?, mode?, currency?, deadline?, artworkClose?, spots?: [{ label?, location?, size?, price, view?, x?, y?, w? }] }` | `Listing` (201) |
| PATCH | `/api/listings/{slug}` | owner + CSRF | `{ title?, story? }` | `Listing` |
| POST | `/api/listings/{slug}/close` | owner + CSRF | — | `Listing` |
| POST | `/api/listings/{slug}/reopen` | owner + CSRF | — | `Listing` |
| DELETE | `/api/listings/{slug}` | owner + CSRF | — | `{ ok: true }` |
| POST | `/api/spots/{id}/claim` | required | `{ website?, logoUrl? }` | `Spot` |
| POST | `/api/spots/{id}/bid` | required | `{ amount, website?, logoUrl? }` | `Spot` |
| POST | `/api/spots/{id}/approve` | owner + CSRF | — | `Spot` |
| POST | `/api/spots/{id}/reject` | owner + CSRF | — | `Spot` |
| POST | `/api/spots/{id}/fulfill` | owner + CSRF | — | `Spot` |

## Rules

- `mode: "fixed"` → claim open spots. Auction spots reject claims (409).
- `mode: "auction"` → bid only. First bid ≥ starting `price`. Later bids must beat current by `minIncrement` (Vincent: 10 EUR). If `doubleUp: true` (Marc), each takeover doubles.
- Claiming/bidding a non-open spot → 409.
- Max 60 spots. Every spot price must be > 0.
- `deadline` is an optional ISO date string and must be in the future. Omitted → 14 days from creation.
- Spot `view` is `"lid"` or `"inside"` (Mac photos) or `"tee-front"` / `"tee-back"` / `"tee-left"` / `"tee-right"` (T-shirt model shots). Omitted or anything else → `"lid"`. Returned on every `Spot`.
- Spot `x`/`y`/`w` are the seller's hand placement in % of the photo (position + width). Omitted → auto layout. Buyers see exactly what the seller placed.
- Listing `fabric` is the tee base color as `#rrggbb` (apparel surface; the seller's default). Anything else → `#f6f6f7`. Returned on every `Listing`.
- Claim/bid accept optional brand assets: `website` must be an http(s) URL, `logoUrl` a `data:image/*` URL under ~3 MB (mock-grade inline storage until object storage lands). Assets attach to the spot, render to every viewer, and a later takeover replaces them.
- Editing, approval, and fulfillment compare immutable user IDs, never X handles.
- Closing hides a listing from the marketplace; the direct link stops resolving. Reopening restores it. Deleting is permanent and refused (409) while any spot has a buyer or bid.

## Types

See `backend/src/types.ts` and `frontend/src/lib/types.ts`.
