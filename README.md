# adspaces

Ad space on anything people see. Creators list a surface (a laptop lid, a car, a bag, a stream) and
split it into spots. Sponsors claim a spot at a fixed price or win it in an auction. The sponsor's USDC
is held on-chain until the creator posts proof of delivery, then paid out.

- App (devnet, test USDC): https://devnet.adspaces.fun
- Website: https://adspaces.fun
- Solana program: [adspaceshq/adspaces-program](https://github.com/adspaceshq/adspaces-program)
- X: [@adspacesfun](https://x.com/adspacesfun)

> **Status:** live on Solana devnet with test USDC, so nothing here moves real money. Mainnet is next.

## How it works

1. **List.** A creator uploads photos, places spots on them and sets prices (fixed or auction). The
   team reviews the listing and sets its fee; the creator accepts and publishes it on-chain.
2. **Claim or bid.** A sponsor pays in USDC, which goes into a vault for that spot. In an auction, an
   outbid sponsor gets their USDC back straight away.
3. **Deliver.** The creator puts the sponsor's brand in place and posts proof.
4. **Get paid.** After the review window the creator is paid, minus the platform fee. If the proof is
   wrong, the sponsor can open a dispute. The team proposes a decision, and it only applies once a
   2-of-3 multisig approves it. If a dispute isn't decided by its deadline, the sponsor can take a full
   refund.

## Architecture

```
browser ──► frontend (Next.js, Vercel) ──► backend API (Express, Render) ──► Postgres (Supabase)
                 │  sign-in + embedded wallet            │
                 └───────────── Privy ◄──────────────────┤ signs through Privy's gasless signer
                                                         ▼
                                       Solana program (Anchor): USDC held per spot
                                       upgrades, settings and fees owned by a Squads 2-of-3 multisig
```

- **Frontend** (`frontend/`): Next.js 16, React Query, Tailwind. It never calls Solana directly; every
  read and transaction goes through the API.
- **Backend** (`backend/`): Express + Drizzle on Postgres (the `app` schema). It builds every
  transaction and records it before sending. A reconciler re-checks the chain every few minutes, and a
  Helius webhook triggers it within seconds of program activity.
- **Wallets:** each user gets a Privy embedded Solana wallet. A Privy policy limits the gasless signer
  to adspaces program instructions; it can never send USDC elsewhere. Withdrawals are signed by the user.
- **Fees and rent** are paid by the platform's key, so users never need SOL.
- **Admin:** the review queue, a ledger that checks each escrow balance against the chain, ops (pause,
  team, rent), and a metrics dashboard.
- Also used: Cloudinary (images), Resend (email), Helius (RPC and webhooks).

## Repository layout

| Path | What's there |
|---|---|
| `frontend/src/app` | Routes: browse, listings and profiles, sell, home and dashboards, wallet, review and admin |
| `frontend/src/components` | UI, grouped by area (`market`, `sell`, `dashboard`, `review`, `ui` kit) |
| `frontend/src/lib` | API client, session, money and fee math |
| `backend/src/v2` | HTTP API (`/api/v2`) and the chain context |
| `backend/src/services` | Listings, purchases, proofs, disputes, settlement, notifications, reconciler, metrics |
| `backend/src/chain` | Program client, transaction runner, Squads proposals, event decoding |
| `backend/drizzle` | Database migrations |

## Run locally

Requirements: Node 22, a Postgres database, and a [Privy](https://dashboard.privy.io) app.

```sh
# API on :8080
cd backend
cp .env.example .env        # fill in the database, Privy and Solana values
npm install
npm run db:migrate
npm run dev

# App on :3000
cd frontend
cp .env.example .env.local  # NEXT_PUBLIC_API_URL=http://localhost:8080 and the Privy app ID
npm install
npm run dev
```

Browsing works without an account. Listing, buying and the wallet need sign-in (Google, X or email).
For on-chain actions the API also needs a reviewer keypair, a Solana RPC URL and the USDC mint; each
variable is explained in `backend/.env.example`.

## Tests

```sh
cd backend && npm test     # services against an in-memory Postgres (PGlite)
cd frontend && npm test    # unit tests (Vitest)
cd frontend && npm run lint
```

The Solana program has its own test suite in its repository.

## Security

Money is held by the Solana program, not by this server. The program was scanned three times with
CertiK's AI Auditor before mainnet, with fixes between runs. These are automated AI scans, not a
manual audit.

Please report security issues privately to support@adspaces.fun.
