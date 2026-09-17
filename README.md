# Spotboard — peer-to-peer ad-space marketplace

Anyone lists a surface, brands claim fixed-price spots or bid in auctions.
X login via Privy; the API verifies the token and owns the session.

## Layout

- `frontend/` — Next.js 16. `:3000`
- `backend/` — Express. `:8080`
- `CONTRACT.md` — API both sides code against

## Local dev

```sh
# API :8080  — needs PRIVY_APP_ID + PRIVY_APP_SECRET
cd backend && cp .env.example .env && npm install && npm run dev

# app :3000  — needs NEXT_PUBLIC_PRIVY_APP_ID
cd frontend && cp .env.example .env.local && npm install && npm run dev
```

Browse is public. List / claim / bid require Log in with X.
