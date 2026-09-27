# Adspaces — project context

Temporary shared source of truth for architecture, decisions, and working notes.
Remove this file when it is no longer needed. Canonical product copy stays in
`README.md`; the API contract stays in `CONTRACT.md`. Keep this file in sync
when those change.

Last updated: 2026-09-27 (Step 4: accept terms goes live).

---

## What we are building

Adspaces is a **peer-to-peer ad-space marketplace**. Anyone lists a surface
people see (gear, body, physical space, digital space, reach). Buyers claim
fixed-price spots or bid in auctions. Crypto is the reason it works globally
(cheap, fast payouts). Tokenization is explicitly out of scope for now.

The thesis comes from Josip Volarević’s Colosseum/Alliance ask
([thread](https://x.com/JosipVolarevic2/status/2096935262743900240)): the
behavior already exists — Solana sold logo space for Nepal flood relief,
people sell X banners, TikTokers sell forehead space — but every campaign
is a custom one-off site. Adspaces is the one marketplace so they don’t
have to ship their own.

**One-line pitch:** people already sell ad space on suitcases, bikes,
laptops, and bodies; Adspaces is the marketplace for that.

---

## Reference campaigns (the product brief)

These four live experiments are the UX and pricing spec. Do not invent a fifth pricing mode until a real
campaign needs it. The backend no longer ships seed listings — it starts empty and sellers create their own.

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
| X identity via Privy (session + CSRF for mutations) | Wallet login, on-chain verification |
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
adspaces/
  README.md              product + local-dev
  CONTRACT.md            API contract both sides code against
  CONTEXT.md             this file (temporary)
  frontend/              Next.js 16 + React 19 + Tailwind 4  → :3000  (Vercel)
  backend/               TypeScript + Express                → :8080  (Docker → Fly/Railway)
```

Deploys are split. Frontend talks to the API via `NEXT_PUBLIC_API_URL`
(default `http://localhost:8080`). See `frontend/src/lib/auth-api.ts`.

Git note as of 2026-09-19: `backend/`, `CONTRACT.md`, and `README.md` are
committed and pushed (`main` ahead of the scaffold). Frontend pages are
wired to the Express API and pushed with the backend.

---

## Architecture

```
browser
  └── Next.js (Privy X OAuth → access token)
        ├── GET  /api/listings, /api/listings/:slug     (public)
        └── POST /api/auth/session  Bearer <Privy access token>
              └── Express verifies token, Set-Cookie: adspaces_sid
                    ├── GET  /api/auth/me
                    └── POST /api/listings, /api/spots/:id/claim|bid
                          identity = session handle, never the request body
```

If the API is unreachable or empty, the frontend shows an empty state
("No live spaces yet") — there is no local seed and no localStorage
fallback. Mutations are API-only: 409s and validation errors surface to
the UI and are thrown, never silently applied locally. Mutating calls
send the session cookie plus the CSRF token issued at login.

### Frontend routes

| Path | Page |
|---|---|
| `/` | Landing: pitch, how-it-works, live listings, FAQ |
| `/browse` | Search + surface filter over all listings |
| `/list` | Create a listing (spots, fixed vs auction) |
| `/listings/[id]` | Detail: spec sheet, claim/bid modal, bid feed |
| `/dashboard` | Seller view: listings, pending approvals, fulfill |
| `/[handle]` | Seller profile: X avatar, verified badge, bio, owner edit + onboarding nudge, listings grid |

`id` in the URL is the listing **slug**.

### Frontend modules that matter

| File | Role |
|---|---|
| `frontend/src/lib/types.ts` | Exact TypeScript mirror of backend types / `CONTRACT.md` |
| `frontend/src/lib/listings.ts` | UI shapes + adapters (`apiListingToUi`, `applyApiSpotToUi`, `minBidFor`) |
| `frontend/src/lib/auth-api.ts` | Typed fetch client; POSTs attach Privy Bearer token |
| `frontend/src/components/StoreProvider.tsx` | Hydration, API-only mutations, empty state when API is down |
| `frontend/src/components/SpecSheet.tsx` | Spot mockup: photo overlay **or** generic grid |
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

| GET | `/api/users/{handle}` | Public `Profile` (payout wallet owner-only, 404 if unknown) |
| PATCH | `/api/users/me` | Owner-only bio/payout-wallet edit |
| GET | `/api/seller/dashboard` | Seller view: listings + pending approvals |
| PATCH | `/api/listings/{slug}` | Owner-only title/story edit |
| POST | `/api/spots/{id}/approve` | Owner approves a claimed spot → `sold` |
| POST | `/api/spots/{id}/reject` | Owner reopens a claimed spot |
| POST | `/api/spots/{id}/fulfill` | Owner marks a sold spot fulfilled |

Errors: `{ "error": string }`. List/claim/bid require the session cookie;
mutating calls additionally require the `X-CSRF-Token` issued at login.
A valid Privy Bearer with no session cookie is a 401 (log in again), never
a 403 — retrying CSRF without a session cannot succeed.
Identity is always the session user — never the request body. Ownership
checks compare stable user IDs, not X handles.

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
Backend listings have no mockup yet — the frontend adapter lays gear
listings out as stickers on the MacBook lid photo (`public/mac/macbook.png`,
layout in `gearPhotoView`, price captioned under each sticker), with the
open shot (`macbook-open.png`) as the card hero and `mac-inside.png` as a
read-only “MacBook inside” tab. Other surfaces keep the 12-col grid, and the
backend still starts empty (no seed images).

Surface keys used by the list form: `gear`, `body`, `physical`, `digital`,
`reach`. There are no seed listings left to mismatch — user-created
listings store the key directly, so the browse filter matches.

---

## Auth

- **Provider:** Privy is the X IdP in the browser. The **API owns the
  session**. After OAuth, the frontend POSTs the access token to
  `/api/auth/session`; the API verifies it with the App Secret and sets
  an httpOnly `adspaces_sid` cookie. List/claim/bid require that session.
- **Frontend:** `NEXT_PUBLIC_PRIVY_APP_ID`. Login uses
  `useLoginWithOAuth({ provider: 'twitter' })`. Wallets are off.
- **Backend:** `PRIVY_APP_ID` + `PRIVY_APP_SECRET` (secret never in the
  frontend). Without the secret, `/api/auth/session` returns 503.
- **Dashboard:** enable X under Login methods → Socials; add
  `http://localhost:3000` to Allowed origins.
- **Identity:** seller/buyer/bidder is always `req.user.handle` (`@username`).
  The client cannot spoof it. Ownership checks compare stable user IDs,
  not X handles.

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

Warm off-white, Inter sans everywhere, one accent.

| Token | Value |
|---|---|
| Page bg | `#fafaf7` |
| Ink | `#020817` |
| Muted | `#64748b` |
| Border | `#e7e5e0` |
| Accent | `#4166fb` |
| Display font | Inter (Apple stack fallback) |
| Body font | Inter (Apple stack fallback) |
| Mono | Inter (Apple stack fallback — no monospace) |

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
docker build -t adspaces-api ./backend
docker run -p 8080:8080 adspaces-api
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
   currently over-claims (“you approve every claim”, “Adspaces does not
   hold your money”) relative to the code. Treat that as aspirational
   until it is true.
10. **API-only frontend, no demo seed (2026-09-19).** Reverses 7–8: the
    in-memory store ships empty (test adapter only), production uses
    Postgres, and the frontend shows an empty state instead of a local
    seed/localStorage fallback. Mutations throw instead of falling back.
11. **Gear mockup = MacBook lid photo with stick-on spots (2026-09-23).**
    `gearPhotoView` places spots on `public/mac/macbook.png` at preset %
    slots (`MAC_LID_SLOTS`), spread per spot count and clear of the Apple
    logo, with the label + price captioned under each sticker. Stickers
    shrink as rows stack (18% one row, 13% stacked) so caption + tile stay
    in their lane down to phone widths. Cards use `macbook-open.png`.
    Two states only — open (dashed) or taken (seller colour) — because
    payments are still mock: no paid/unpaid badges, no drag-and-drop
    placement (that is gap 1 below).
12. **Sticker place / move / resize / remove in the list-form preview (2026-09-23).**
    The `Preview` panel on `/list` is an editor, still preview-only —
    publishing lays spots out automatically, since the API has no mockup
    column yet. Clicking bare lid drops a spot at that point; dragging a
    sticker (or arrow keys / shift-arrow on it) moves it; dragging the
    corner handle (or ←/→ on the handle, shift for bigger steps) resizes
    it, and double-clicking the handle drops back to the auto width.
    `LidPlacement` is now `{ x?, y?, w? }`: an omitted field falls back to
    the auto slot/width, so a sticker can be moved without resizing it and
    vice versa. Width is clamped to 6–34% (`clampStickerWidth`) and the
    position is re-clamped against the new width so sticker + caption stay
    on the lid. Hovering a sticker also reveals a small × on its top
    corner (always visible on touch, where there is no hover, and
    Delete/Backspace works on a focused sticker) that drops that spot and
    its row above; it hides once the listing is down to one spot, matching
    the row button. Buyer pages never get the editor props, so they stay
    read-only. This closes the “drag-and-drop placement” half of gap 1;
    image upload and persisting the layout server-side are still open.
13. **“MacBook inside” is a read-only reference tab (2026-09-23).** Gear
    spec sheets carry two views: “MacBook lid” (the sticker surface, from
    `gearPhotoView`) and “MacBook inside” (`mac-inside.png`, a top-down
    flat-lay of the keyboard deck, from `gearInsideView`). The inside view
    has no `spots` list, so no stickers land on it and `SpecSheet` keeps
    the seller editor off it (`editing = !!onPlaceSpot && !!active.spots`):
    a click there cannot drop a lid-relative sticker onto another photo.
    Its footer swaps the claimed count for “stickers live on the lid”. The
    tab strip only renders when `views.length > 1`, so single-view listings
    (a listing with its own photo, or a 12-col grid) are unchanged. Both the
    `/list` preview and `apiListingToUi` build their views through the same
    two factories, so buyer pages get the inside tab too. The inside shot is
    a 1.5 MB PNG — compress it to WebP (as `macbook-open.png` was) before
    real traffic. `frontend/public/mac/` was untracked until now, so the
    in-use lid and hero shots 404’d on a fresh clone; all three are tracked.
14. **Spot `view` persisted: lid/inside placement survives publish (2026-09-25).**
    Reverses the second half of 13: the inside view is a real sticker
    surface for buyers too, not a reference tab. New `Spot.view`
    (`"lid"` | `"inside"`, omitted → `"lid"`) in `CONTRACT.md`,
    `backend/src/types.ts`, Postgres (`spots.view`, backfilled `"lid"`),
    the in-memory store, and `frontend/src/lib/types.ts`. `/list`
    publishes each spot with its view and `apiListingToUi` partitions lid
    vs deck spots into the two     views. Listings published before this change
    keep all spots on the lid — republish to move stickers inside.
15. **Editor pins positions; nothing teleports (2026-09-26).** Adding the
    2nd sticker used to re-run the per-count auto layout, yanking placed
    stickers to new slots. Now `pinDraftPositions` freezes every unpinned
    draft at its current slot whenever a sticker is added or removed;
    click-drops land at the cursor, toolbar adds take the emptiest preset
    slot (`freeSlotOnView`), width stays auto until hand-resized. Pinned
    x/y publish through the existing columns, so the buyer layout is the
    seller layout, exactly.
16. **T-shirt category with a 3D buyer view (2026-09-26).** New `apparel`
    surface beside `gear`; the Mac flow is untouched. Sellers pick
    MacBook lid vs T-shirt on `/list`: the tee editor reuses the `SpecSheet`
    click/drag/resize treatment on flat front/back photos
    (`public/tee/tee-front.svg`, `tee-back.svg`, views `"tee-front"` /
    `"tee-back"`, chest-first preset slots, wider auto widths for print
    zones). Buyers get `TeeViewer` (three.js + OrbitControls, SSR-off):
    orbit/zoom, white/black fabric dots, front/side/back presets, spin
    toggle, and tap-a-zone claim/bid with buyer logos as canvas textures.
    `Spot.view` allowlist grew to lid/inside/tee-front/tee-back in
    `CONTRACT.md`, `backend/src/types.ts`, `store.ts`, `market.ts`
    (unknown → `"lid"`, as before), and `frontend/src/lib/types.ts` +
    `listings.ts`. Tee listings skip the `mac-N` short key and redirect to
    `/listings/[slug]` after publish; browse filter and cards pick the new
    surface up automatically.
17. **Tee colors (2026-09-26).** Sellers pick one of five fabric swatches on
    `/list` (white/black/navy/forest/sand); it tints the flat preview via a
    shirt-masked multiply overlay in `SpecSheet`, persists as `Listing.fabric`
    (`#rrggbb`, anything else → `#f6f6f7`, in `CONTRACT.md`, both backend
    repos sharing the identical rule, and `ApiListing`), and loads as the
    buyer 3D default — buyers can still switch swatches live (preview-only).
    Browse cards keep the white flat art.
18. **Avatar fitting-room mode (2026-09-26).** The 3D viewer has a Tee/Avatar
    toggle; Avatar arms once `frontend/public/tee/avatar.glb` exists
    (auto-detected, procedural tee stays the fallback). Any full-body file
    works — it is normalized to scene height with feet on the floor — and
    materials with TeeFabric/shirt in the name follow the fabric swatches.
    Print zones pin to chest constants (`AVATAR_CHEST_Z`), retune when the
    real file lands. Easiest path to a file: readyplayer.me full-body
    avatar → download `.glb` → rename to `avatar.glb`.
    Landed 2026-09-26: `summonn_boy_avatar.glb` (stylized boy, vertex
    colors, dedicated `T_Shirt_REPLACE_ME` mesh, no materials). It is
    authored Z-up, so the viewer tips it -90° about X into Y-up facing +Z,
    normalizes height, and tints by mesh/material name match (shirt follows
    swatches).     Chest constants measured from its accessors
    (`AVATAR_CHEST_Z` 0.235, `AVATAR_CHEST_X` 0.55).
    Seller side too: `/list` renders the same viewer below the flat editor
    for tee listings (claim/bid no-ops; preview spots carry view/x/y/w).
19. **Model-file detection must read magic bytes, not status (2026-09-26).**
    `HEAD /tee/tshirt.glb` returns **200** with HTML — the
    `/[handle]/[listing]` route matches any two-segment path — so the old
    `r.ok` gate armed the GLB loader for a missing file and drei threw
    (`<!DOCTYPE is not valid JSON`), crashing `/list`. Detection now
    fetches `Range: bytes=0-3` and requires the `glTF` magic, and a
    `ModelErrorBoundary` falls back to the procedural tee if a present file
    ever fails to parse.
20. **T-shirt/3D feature removed entirely (2026-09-26).** Reverses 16–19:
    `TeeViewer.tsx`, `public/tee/` (`avatar.glb`, flat SVGs), the three.js
    deps, `apparel` surface, `tee-front`/`tee-back` views, `Listing.fabric`,
    and all seller/buyer wiring are gone from frontend and backend
    (`CONTRACT.md` back to lid/inside). `/list` is Mac-only again. History
    above stays as record.
21. **Tee back without 3D (2026-09-26).** Reverses the 3D half of 16–19:
    no `TeeViewer`, no three.js deps, no avatar, no model detection. The
    T-shirt stays a sellable `apparel` surface with the flat front/back
    editor, tinted preview, fabric colors, and buyer `SpecSheet` views —
    claim/bid on the flat photos exactly like the Mac lid.
22. **Tee model photo replaces the flat SVGs (2026-09-26).** One `Tee`
    view on `public/tee/tee-model.png` (seller editor + buyer view);
    `tee-front.svg` / `tee-back.svg` deleted. Legacy `tee-back` spots
    render as front, so no contract change. No fabric tint — the shot is
    full-bleed (skin, backdrop), not white flat art — and new tee listings
    record `fabric` `#1b1b20` to match the black tee in the photo. Chest
    slots re-tuned to the print box; retune once final art lands.
23. **Four tee views — front/back/left/right model shots (2026-09-26).**
    Supersedes the single-view half of 22: back + both side profiles join
    the front as seller editor surfaces and buyer views, each with its own
    preset slots. `Spot.view` allowlist grows to
    `tee-front`/`tee-back`/`tee-left`/`tee-right` in `CONTRACT.md`,
    both backend repos, and the frontend adapter (unknown → `"lid"`, as
    before). Buyer pages get the same four tabs through the shared
    factories — no buyer-side work outstanding.
24. **Real seller profile at `/{username}` (2026-09-27, workflow Step 1).**
    Every X login owns a profile row (created in `createSession`, so the
    page resolves with zero listings). `Profile` is
    `{ id, handle, displayName?, avatar?, bio, payoutWallet?, verified }`
    in `CONTRACT.md`, both `types.ts` mirrors, and Postgres (`users.bio`,
    `users.payout_wallet`, `users.verified`, default true = X-linked — no
    separate KYC yet). `GET /api/users/:handle` is public and
    case-insensitive/`@`-optional; `payoutWallet` is stripped for
    non-owners. `PATCH /api/users/me` (session + CSRF) takes only
    `bio` (≤280) and `payoutWallet` (empty = clear, else Solana base58
    32–44); unknown fields ignored. The page fetches the profile first
    and falls back to the old listings-derived display when the API 404s
    or is down. Owner UI compares stable user IDs (`AuthSession.userId`,
    new) and shows an incomplete-profile nudge until bio + wallet are
    set. Wallet format is validated, ownership is not verified — that
    lands with real payments (gap 2).
25. **Submit listing lands as `submitted` (2026-09-27, workflow Step 2).**
    Jev picked strand over interim-publish/auto-approve (0.99), no draft
    state (0.30), data-URL images (0.77), guarded reopen (0.94).
    `Listing.status` is `"active" | "submitted" | "closed"` in `CONTRACT.md`,
    both `types.ts` mirrors, Postgres (CHECK migrated), and the in-memory
    store. `POST /api/listings` creates `submitted` (hidden from summaries
    and claim/bid, owner-visible via dashboard + direct link); closing
    withdraws from any status; reopen resubmits (`closed` → `submitted`,
    `submitted` → 409, `active` → no-op) so nothing self-publishes before
    platform review (Step 3). `image` is a `data:image/*` URL ≤ ~3 MB
    (same mock-grade pattern as buyer logos; `express.json` raised to 4 MB),
    client-shrunk to 1200px JPEG on `/list`, whose dialog now reads
    “Submit for review” and lands on `/dashboard` (Submitted badge +
    Close/Delete, closed rows offer Resubmit). Submissions stay PATCH-editable
    while pending. Buyer happy-path HTTP coverage is thin until review can
    activate listings — purchase/authz tests assert the strand (409s) meanwhile.
26. **Platform review with allowlist (2026-09-27, workflow Step 3).**
    No admin system: reviewers are named in `PLATFORM_REVIEWERS`
    (handles or stable user IDs, IDs survive renames; empty = no
    reviewers). `GET /api/review/queue` + `POST
    /api/listings/:slug/approve|reject` are session + CSRF + reviewer
    gated (401/403 otherwise; 404 unknown, 409 not-submitted). Approve →
    `active` (summaries, claim/bid work again); reject → `closed` with a
    `reviewNote` (≤500) surfaced on the seller dashboard and cleared on
    approve/resubmit. Self-approval allowed until RBAC. Buyer happy-path
    HTTP coverage is restored via approval in the tests (25 pass). The
    operator sets `PLATFORM_REVIEWERS=@you` (see `backend/.env.example`);
    reviewers work the `/review` page (`review` added to the profile
    `RESERVED` set so the route can't collide with a username).
27. **Accept terms goes live (2026-09-27, workflow Step 4).**
    Jev picked per-listing acceptance (1.0), a distinct `approved` state
    (0.87), and version pinning (0.92). `GET /api/terms` serves the
    versioned doc (`TERMS_VERSION = "v1"`, short demo terms in
    `backend/src/types.ts`); reviewer approval now lands `submitted` →
    `approved` (still hidden, unbuyable). Owners activate with `POST
    /api/listings/:slug/accept-terms` (`{ version }` must equal current,
    else 400; non-approved → 409; non-owner → 403; live → no-op),
    recording `termsVersion` + `termsAcceptedAt` and flipping `active`.
    Reopening an `approved` listing resubmits it. The dashboard shows an
    Approved badge with a Review-terms modal (Accept & go live); the
    `/list` dialog notes terms follow approval. Buyer happy-path tests
    now run approve → accept → claim/bid (28 pass).

---

## Known gaps / likely next work

Rough priority, not a commitment:

1. Image upload + persisting a hand-placed sticker layout (the `/list`
   preview already lets a seller drop, move, and resize stickers, but the
   layout is preview-only — the API has no mockup column).
2. Real payments: Solana USDC (and/or Stripe), verify `txSignature`,
   refunds on outbid for `doubleUp` auctions.
3. Artwork intake, proof uploads, and buyer notifications.
4. Wallet login via Privy once money moves.
5. Listing pause/close controls and richer seller reporting.

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
