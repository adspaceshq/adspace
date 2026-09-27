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

`SessionUser = { id, did, handle, name?, avatar? }`. `id` is Adspaces' stable user ID. The immutable Privy DID and X subject are stored server-side; `handle` is mutable profile data. `SessionResponse` adds `{ csrfToken, expiresAt, isReviewer }` (`isReviewer` mirrors the `PLATFORM_REVIEWERS` allowlist so the UI can reveal reviewer routes).

List/claim/bid **require** a session. Seller/buyer/bidder is always `req.user.handle` — never the request body.

## Profiles (Step 1: Create profile)

Every X login auto-creates the `users` row, so `3000/{username}` resolves even
with zero listings. The profile is public; editing is owner-only.

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `/api/users/{handle}` | public | — | `Profile` (404 if unknown) |
| PATCH | `/api/users/me` | required + CSRF | `{ bio?, payoutWallet? }` | `Profile` |
| GET | `/api/review/queue` | reviewer (session) | — | `Listing[]` (`submitted`, oldest last) |
| POST | `/api/listings/{slug}/approve` | reviewer + CSRF | — | `Listing` (`approved`) |
| POST | `/api/listings/{slug}/reject` | reviewer + CSRF | `{ reason? }` | `Listing` (`closed` + `reviewNote`) |
| GET | `/api/terms` | public | — | `{ version, text }` (current seller terms) |
| POST | `/api/listings/{slug}/accept-terms` | owner + CSRF | `{ version }` | `Listing` (`active`) |

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
| POST | `/api/listings` | required | `{ title, surface?, story?, image?, fabric?, mode?, currency?, deadline?, artworkClose?, spots?: [{ label?, location?, size?, price, view?, x?, y?, w? }] }` | `Listing` (201, `submitted`) |
| PATCH | `/api/listings/{slug}` | owner + CSRF | `{ title?, story? }` | `Listing` |
| POST | `/api/listings/{slug}/close` | owner + CSRF | — | `Listing` |
| POST | `/api/listings/{slug}/reopen` | owner + CSRF | — | `Listing` |
| DELETE | `/api/listings/{slug}` | owner + CSRF | — | `{ ok: true }` |
| POST | `/api/spots/{id}/claim` | required | `{ website?, logoUrl }` | `Spot` |
| POST | `/api/spots/{id}/bid` | required | `{ amount, website?, logoUrl }` | `Spot` |
| POST | `/api/spots/{id}/artwork` | buyer + CSRF | `{ website?, logoUrl? }` | `Spot` |
| POST | `/api/spots/{id}/proof` | seller + CSRF | `{ photos: string[1..5], postUrl? }` | `Spot` |
| POST | `/api/spots/{id}/confirm` | buyer + CSRF | — | `Spot` (idempotent) |
| POST | `/api/spots/{id}/dispute` | buyer + CSRF | `{ reason? }` | `Spot` (replaces reason) |
| POST | `/api/spots/{id}/withdraw` | buyer + CSRF | — | `Spot` |
| GET | `/api/review/payable` | reviewer (session) | — | `PayoutItem[]` (released, unpaid) |
| POST | `/api/spots/{id}/pay` | reviewer + CSRF | `{ reference? }` | `Spot` (idempotent) |
| POST | `/api/spots/{id}/approve` | owner + CSRF | — | `Spot` |
| POST | `/api/spots/{id}/reject` | owner + CSRF | — | `Spot` |
| POST | `/api/spots/{id}/fulfill` | owner + CSRF | — | `Spot` |

## Rules

- Step 2 (submit): `POST /api/listings` creates the listing as `submitted` —
  hidden from the marketplace, summaries, and claim/bid (which require
  `active`), visible to the owner via the dashboard and the direct link.
  `submitted` goes live only through platform review, then terms — there is
  no seller-side publish. Closing withdraws from any status; reopening a
  closed listing resubmits it (`closed` → `submitted`), never activates it;
  reopening a `submitted` listing is a 409, reopening `approved` resubmits it,
  reopening an `active` one is a no-op.
  Statuses: `"active" | "approved" | "submitted" | "closed"`.
- Step 4 (terms): reviewer approval moves `submitted` → `approved` (still
  hidden and unbuyable). The owner then accepts the current terms with
  `POST /api/listings/:slug/accept-terms` (`{ version }` must equal the
  `GET /api/terms` version, else 400) — this records `termsVersion` +
  `termsAcceptedAt` on the listing and flips it `active`. Accepting a
  non-approved listing is a 409, a non-owner gets 403, accepting a live
  listing is a no-op, and accepting past the deadline is a 409
  (close and relist).
- Step 5 (live): the deadline is enforced lazily — no scheduler, no `ended`
  status. Summaries exclude past-deadline actives; claim/bid on one is a 409
  (`listing has ended`); the direct link still resolves so sellers and buyers
  see the outcome. `artworkClose` stays display-only until artwork intake
  (step 7) gives it something to enforce. Deadlines can't be extended —
  close and relist.
- Listing `image` is the seller's surface photo as a `data:image/*` URL under
  ~3 MB (mock-grade inline storage until object storage lands, same pattern
  as buyer logos). Anything else → 400. Omitted → the preset surface photos.
- Buying carries the art: `logoUrl` is required on claim/bid (400 if
  missing), so every sold spot has something to produce with — no second
  step, no stuck states. Fulfill is unconditional on sold spots again.
- Step 9 (proof): after fulfilling, the seller pins delivery evidence to
  the spot with `POST /api/spots/:id/proof` — 1–5 photos as `data:image/*`
  URLs (≤3 MB each, same mock-grade pattern) plus an optional X-post link
  (`https` on `x.com`/`twitter.com`). Seller-only (403), fulfilled spots
  only (409 — fulfill first), replaces the previous set. Buyers read the
  proof on the detail page; it is the verification input for payout.
- Review period (lazy 3-day window from `fulfilledAt`, no scheduler): the
  buyer confirms receipt (`confirm`, idempotent, early release), disputes
  (`dispute`, optional `reason` ≤500, replaced on repeat, blocked once
  confirmed), or withdraws their dispute (`withdraw`). All three are
  buyer-only (403), fulfilled-only (409). A spot is payout-released when
  undisputed AND (confirmed OR the window elapsed) — computed from the
  timestamps, enforced by payout. Disputes surface in seller attention.
- Get paid (manual USDC; no custody, no escrow yet): the reviewer sends the
  USDC transfer from their own wallet, then records it with `POST
  /api/spots/:id/pay` (reviewer + CSRF, `{ reference }` = the Solana
  transaction signature, ≤200 chars). Only released spots (409 otherwise);
  the seller must have a payout wallet set (409); idempotent — paying twice
  returns the same record. A sig-like reference is verified on-chain when
  `SOLANA_RPC_URL` is set (amount + destination + USDC mint for the
  cluster); set `PAYOUT_REQUIRE_ONCHAIN=1` to require a signature plus
  verification and reject memo-style references (400). Each record snapshots
  `amount`, `fee` (`PLATFORM_FEE_BPS`, default 0 — shown, not moved),
  `net`, and `destination`. `GET /api/review/payable` lists
  released-but-unpaid spots for the ops console (`/review` payouts
  section). Paid sums surface on the dashboard; buyers see PAID on own
  spots (explorer link when the reference is a signature). Purchase-time
  claims/bids stay mock-marked — no money moves until this step.
- Step 7 (artwork, optional upgrade): `artworkClose` is an optional ISO
  date (empty = none, else must parse, 400). After a spot is sold, its
  buyer may replace the purchase art with `POST /api/spots/:id/artwork`
  — same asset rules, no client shrink, at least one of `website`/`logoUrl`
  required. Only the buyer (403 otherwise), only sold spots (409), locked
  after `artworkClose` (409). Intake replaces the assets in place and
  stamps `artworkSubmittedAt`. Reminders are UI surfacing only.
- Step 3 (review): reviewers are named in `PLATFORM_REVIEWERS` (X handles,
  `@` optional, or stable user IDs — IDs survive renames). The queue lists
  `submitted` listings newest-first; approve flips to `active` (visible,
  buyable) and clears the note; reject closes with `reviewNote` (≤500 chars,
  else 400) that the seller sees on the dashboard. Both are 404 on unknown
  slugs, 409 when not awaiting review, 403 for non-reviewers. Self-approval
  is permitted while reviewers are named individuals — revisit with RBAC.
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
