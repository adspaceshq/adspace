# Spotboard — project context

Temporary shared source of truth for architecture, decisions, and working notes.
Remove this file when it is no longer needed. Canonical product copy stays in
`README.md`; the API contract stays in `CONTRACT.md`. Keep this file in sync
when those change.

Last updated: 2026-09-17 (API session after X login).

---

## What we are building

Spotboard is a **peer-to-peer ad-space marketplace**. Anyone lists a surface
people see (gear, body, physical space, digital space, reach). Buyers claim
fixed-price spots or bid in auctions. Crypto is the reason it works globally
(cheap, fast payouts). Tokenization is explicitly out of scope for now.

The thesis comes from Josip Volarević’s Colosseum/Alliance ask
([thread](https://x.com/JosipVolarevic2/status/2096935262743900240)): the
behavior already exists — Solana sold logo space for Nepal flood relief,
people sell X banners, TikTokers sell forehead space — but every campaign
is a custom one-off site. Spotboard is the one marketplace so they don’t
have to ship their own.

**One-line pitch:** people already sell ad space on suitcases, bikes,
laptops, and bodies; Spotboard is the marketplace for that.

---

## Reference campaigns (the product brief)

These four live experiments are the UX and pricing spec. Seed data in the
backend mirrors them. Do not invent a fifth pricing mode until a real
campaign needs it.

| Seller | Surface | Model | Buyer gets | Source |
|---|---|---|---|---|
| Vincent (@VynseDev) | MacBook lid (+ later BrandMyLaptop marketplace) | Live auction, min increment 10 EUR | Sticker on a laptop seen online and IRL. Auction funds the laptop. | [post](https://x.com/VynseDev/status/2092544016315306400) |
| winny (@winternet) | Ironman kit + frame + helmet | Fixed price, 11–12 spots | Logo does 1,500+ training miles + races. | [post](https://x.com/winternet/status/2092720263976886372) |
| vana (@coinempress) | Suitcase to TOKEN2049 | Fixed price, 18 spots from $125 | Logo travels + packing vlog + recap. | [post](https://x.com/coinempress/status/2096943568208146499) |
| Marc Lou (@marclou) | Body / HYROX race-day tattoos | Auction, each takeover **doubles**; outbid = refunded minus Stripe fee | Tattoo + site listing + YouTube/X. | [post](https://x.com/marclou/status/2097326512169222407) |

Shared pattern in every campaign:

1. A surface people see.
2. Split into numbered spots (label, location, size, price).
3. A story / goal, a deadline, and an artwork-close date.
4. Either claim at a price or bid.
5. Distribution is an X post with a photo or video of the surface.

---

## Current status (honest)

Working **demo marketplace**, not a payments product.

| Have | Don’t have yet |
|---|---|
| List / browse / claim / bid | Real money (USDC on Solana, or Stripe like Marc) |
| Two pricing modes, including `doubleUp` | Escrow, refunds on outbid, seller payouts |
| Postgres persistence for users, sessions, listings, spots, claims, and bids | Image upload, real mockup editor |
| X identity via Privy (optional) | Wallet login, on-chain verification |
| Generic photo-grid / overlay mockup | Vincent-style sticker overlay editor, Marc-style 3D body |
| Seller dashboard with approve / reject / fulfill | Artwork intake, proof uploads, buyer notifications |

Money is mock. Claims and bids mark spots. `txSignature` is accepted and
logged as a Solana hook; nothing is verified on-chain. Stripe and Solana
packages sit in the frontend unused.

Next layer (from `README.md`): **image workflow + Stripe/crypto**. The HTTP
contract is meant to stay stable.

---

## Repo layout

```
spotboard/
  README.md              product + local-dev
  CONTRACT.md            API contract both sides code against
  CONTEXT.md             this file (temporary)
  frontend/              Next.js 16 + React 19 + Tailwind 4  → :3000  (Vercel)
  backend/               TypeScript + Express                → :8080  (Docker → Fly/Railway)
```

Deploys are split. Frontend talks to the API via `NEXT_PUBLIC_API_URL`
(default `http://localhost:8080`). See `frontend/src/lib/auth-api.ts`.

Git note as of 2026-09-17: `backend/`, `CONTRACT.md`, and `README.md` are
still untracked. Committed history is the Next.js scaffold and pages.
Uncommitted frontend work wires those pages to the Express API.

---

## Architecture

```
browser
  └── Next.js (Privy X OAuth → access token)
        ├── GET  /api/listings, /api/listings/:slug     (public)
        └── POST /api/auth/session  Bearer <Privy access token>
              └── Express verifies token, Set-Cookie: spotboard_sid
                    ├── GET  /api/auth/me
                    └── POST /api/listings, /api/spots/:id/claim|bid
                          identity = session handle, never the request body
```

If the API is unreachable, the frontend falls back to a local seed
(currently only Vincent’s MacBook) plus localStorage claims/bids, so the
demo still runs. API-known listings are **API-first**: 409s and validation
errors surface to the UI; only a network `TypeError` falls back to local
state.

### Frontend routes

| Path | Page |
|---|---|
| `/` | Landing: pitch, how-it-works, live listings, FAQ |
| `/browse` | Search + surface filter over all listings |
| `/list` | Create a listing (spots, fixed vs auction) |
| `/listings/[id]` | Detail: spec sheet, claim/bid modal, bid feed |

`id` in the URL is the listing **slug**.

### Frontend modules that matter

| File | Role |
|---|---|
| `frontend/src/lib/types.ts` | Exact TypeScript mirror of backend types / `CONTRACT.md` |
| `frontend/src/lib/listings.ts` | UI shapes + adapters (`apiListingToUi`, `applyApiSpotToUi`, `minBidFor`) |
| `frontend/src/lib/auth-api.ts` | Typed fetch client; POSTs attach Privy Bearer token |
| `frontend/src/components/StoreProvider.tsx` | Hydration, API-first mutations, local fallback |
| `frontend/src/components/SpecSheet.tsx` | Spot mockup: photo overlay **or** BrandMyMac-style grid |
| `frontend/src/components/PrivyAppProvider.tsx` | X-only Privy; no-ops if App ID missing |
| `frontend/src/components/AuthButton.tsx` | Login/logout + `XProbe` for pages that need the handle |

Keep `types.ts` in lockstep with `backend/src/types.ts` and `CONTRACT.md`.

### Backend modules

| File | Role |
|---|---|
| `backend/src/index.ts` | Express, CORS, optional auth, routes |
| `backend/src/db.ts` | Supabase Postgres pool, users, persistent sessions |
| `backend/src/market.ts` | Postgres marketplace repository and seller dashboard queries |
| `backend/src/store.ts` | In-memory test/demo repository |
| `backend/src/auth.ts` | Privy token verify + display name (`@handle` > truncated wallet > `user-…`) |
| `backend/src/types.ts` | Canonical types |

Production routes use Postgres, so user-created listings, claims, and bids
survive restarts. The in-memory store remains only as the test/demo adapter.

---

## API contract (v1, mock money)

Full spec: `CONTRACT.md`. Summary:

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | `{ status, auth }` |
| POST | `/api/auth/session` | Exchange Privy Bearer for session cookie |
| GET | `/api/auth/me` | Current `SessionUser` |
| POST | `/api/auth/logout` | Clear cookie |
| GET | `/api/listings` | `ListingSummary[]` |
| GET | `/api/listings/{slug}` | `Listing` with `spots` |
| POST | `/api/listings` | Create. Seller = session handle. 401 if not signed in. |
| POST | `/api/spots/{id}/claim` | Fixed-price only. 409 on auction or already taken. |
| POST | `/api/spots/{id}/bid` | Auction only. Must beat current by `minIncrement`, or double if `doubleUp`. |

Errors: `{ "error": string }`. Auth is optional: valid Privy Bearer attaches
`req.user`; missing/invalid tokens fall through to demo-mode names so local
dev works without login.

`txSignature` is accepted on claim/bid and only logged. Verify on-chain
before real money.

### Pricing rules (do not drift from the demos)

- `mode: "fixed"` (vana, winny) → claim open spots. Auction spots reject claims (409).
- `mode: "auction"` (Vincent, Marc) → bid only.
  - First bid ≥ starting `price`.
  - Later bids must beat current by `minIncrement` (Vincent: 10 EUR).
  - If `doubleUp: true` (Marc), each takeover doubles.
- Claiming/bidding a non-open spot → 409.
- Max 60 spots per listing. Every spot price must be > 0.

---

## Data model

```ts
Listing {
  id, slug, title, seller, sellerHandle, surface, story, image,
  mode: "fixed" | "auction",
  currency, deadline, artworkClose,
  minIncrement?, doubleUp?,
  spots: Spot[]
}

Spot {
  id, listingId, label, location, size, price, currency,
  status: "open" | "claimed" | "sold",
  currentBid?, buyer?, bids?: Bid[]
}

Bid { bidder, amount, at }
```

UI listings add `mockup.views` (photo overlay coordinates or a 12-col grid).
Backend listings have no mockup yet — the adapter lays spots on a simple
3-column grid, or a photo grid if `image` is a real URL. Backend seed images
are `/demo/*.jpg` and the frontend treats those as missing (they are not
shipped). Vincent’s MacBook is the only listing with real mockup photos
(`frontend/public/mac/`).

Surface keys used by the list form: `gear`, `body`, `physical`, `digital`,
`reach`. Seeded listings currently store a human sentence in `surface`
(e.g. `"Suitcase (front / back / sides)"`), so the browse filter by key
does not match seeds. Worth aligning later.

---

## Auth

- **Provider:** Privy is the X IdP in the browser. The **API owns the
  session**. After OAuth, the frontend POSTs the access token to
  `/api/auth/session`; the API verifies it with the App Secret and sets
  an httpOnly `spotboard_sid` cookie. List/claim/bid require that session.
- **Frontend:** `NEXT_PUBLIC_PRIVY_APP_ID`. Login uses
  `useLoginWithOAuth({ provider: 'twitter' })`. Wallets are off.
- **Backend:** `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (secret never in the
  frontend). Without the secret, `/api/auth/session` returns 503.
- **Dashboard:** enable X under Login methods → Socials; add
  `http://localhost:3000` to Allowed origins.
- **Identity:** seller/buyer/bidder is always `req.user.handle` (`@username`).
  The client cannot spoof it.

---

## Payments (planned, not built)

Env already sketches the rail:

- Frontend: `NEXT_PUBLIC_SOLANA_NETWORK=devnet`
- Backend: `SOLANA_NETWORK=devnet`, commented `SELLER_TREASURY_ADDRESS`

Frontend already depends on `@solana/kit`, `@solana/web3.js`, token/memo
programs, and `@stripe/stripe-js` — unused. Marc’s campaign refunds
outbids minus Stripe fee; that is the auction-refund behavior to match
when money is real.

Josip’s constraint: **crypto is critical** for global cheap fast payouts.
Stripe can exist as a parallel rail; do not make it the only path.

---

## Design tokens

Warm off-white, serif display, one accent.

| Token | Value |
|---|---|
| Page bg | `#fafaf7` |
| Ink | `#020817` |
| Muted | `#64748b` |
| Border | `#e7e5e0` |
| Accent | `#4166fb` |
| Display font | Hedvig Letters Serif |
| Body font | Inter |
| Mono | Roboto Mono |

Hero is a dark radial gradient (teal/pink/blue) used only on `/`. Do not
spread that treatment to browse/list/detail.

Copy voice: short, concrete, no marketplace jargon. Demo disclaimers stay
visible until real money ships (FAQ, footer, claim modal).

---

## Local dev

```sh
# backend :8080
cd backend && npm install && npm run dev

# frontend :3000
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

Env templates: `backend/.env.example`, `frontend/.env.example`. Never
commit `.env`.

Docker (backend only):

```sh
docker build -t spotboard-api ./backend
docker run -p 8080:8080 spotboard-api
```

---

## Decisions (keep this list honest)

1. **Generalize the four demos, don’t clone one of them.** Modes and rules
   exist because vana/winny/Vincent/Marc already ran. New modes need a
   real campaign.
2. **Mock money first, contract stable.** Persistence and payments swap
   behind the same HTTP shapes.
3. **Split frontend/backend deploys.** Vercel + Docker. CORS via
   `FRONTEND_URL` (open `*` in local default).
4. **Auth is optional until Privy is configured.** Demo must work with a
   typed name. When logged in, identity comes from the token, not the body.
5. **X-only login for now.** Wallet login and wallet display come with
   real payments.
6. **No tokenization in v1.** Josip called this out; leave it out.
7. **In-memory store is acceptable for the demo.** Seed deadlines are
   relative so the four campaigns never look expired.
8. **API-first mutations, local fallback only on network failure.** Do not
   swallow 409s — “already taken” must reach the UI.
9. **Seller approval / escrow / fulfillment are later.** Homepage copy
   currently over-claims (“you approve every claim”, “Spotboard does not
   hold your money”) relative to the code. Treat that as aspirational
   until it is true.

---

## Known gaps / likely next work

Rough priority, not a commitment:

1. Image upload + a real mockup editor (place spots on a photo).
2. Real payments: Solana USDC (and/or Stripe), verify `txSignature`,
   refunds on outbid for `doubleUp` auctions.
3. Artwork intake, proof uploads, and buyer notifications.
4. Align seed `surface` values with the list-form keys so browse filters
   work on demos.
5. Wallet login via Privy once money moves.
6. Listing pause/close controls and richer seller reporting.
7. Ship the four demo photos (`/demo/*`) or stop referencing them.

---

## How to maintain this file

- Update **Last updated** when you change anything material.
- New architectural decision → add a numbered item under Decisions,
  don’t rewrite history; append and note if something was reversed.
- Contract change → edit `CONTRACT.md` first, then a one-line pointer here.
- When Postgres / payments / auth land, replace the “Current status”
  table instead of leaving stale “don’t have yet” rows.
- Delete this file when the repo’s real docs (README + CONTRACT + code)
  are enough and the team no longer needs a scratch context pad.
