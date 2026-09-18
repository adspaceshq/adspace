# Spotboard — peer-to-peer ad-space marketplace

Anyone lists a surface, brands claim fixed-price spots or bid in auctions.
X login via Privy; the API verifies the token and owns the session.

## Layout

- `frontend/` — Next.js 16. `:3000`
- `backend/` — Express. `:8080`
- `CONTRACT.md` — API both sides code against

## Local dev

```sh
# API :8080  — needs DATABASE_URL + PRIVY_APP_ID + PRIVY_APP_SECRET
cd backend && cp .env.example .env && npm install && npm run dev

# app :3000  — needs NEXT_PUBLIC_PRIVY_APP_ID
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

Browse is public. List / claim / bid require Log in with X.

Authentication users and hashed session tokens are persisted in Postgres. The
immutable Privy DID and X subject establish identity; the current X handle is
mutable profile data refreshed at login. Mutations require a session-bound CSRF
token and are rate limited. Seller actions authorize against the stable internal
user ID rather than the handle.

Listings, spots, claims, and bids are also persisted in Postgres. `/dashboard`
gives each seller an ownership-scoped view of their listings and pending work,
with approve, reject, and fulfillment actions. Database tables have RLS enabled
and are accessible only through the authenticated API.
