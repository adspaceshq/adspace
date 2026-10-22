# adspaces API

Express + Drizzle on Postgres. It owns sessions, builds and sends every Solana transaction, and keeps
the database in step with the chain. See the [root README](../README.md) for the overall picture.

## Run

```sh
cp .env.example .env   # every variable is explained there
npm install
npm run db:migrate     # apply migrations in drizzle/
npm run dev            # :8080, reloads on change
```

`npm run build && npm start` runs the compiled server. A `Dockerfile` is included.

## How it fits together

- `src/server.ts` reads the config, checks it, and starts the API and the background jobs:
  - the reconciler (transactions and on-chain changes the API didn't send);
  - notifications (email through Resend);
  - operator alerts.

  `src/index.ts` only builds the Express app, so tests can use it without a listener.
- `src/v2/router.ts` is the HTTP API under `/api/v2`. Sessions are an httpOnly cookie, and every change
  needs the session's CSRF token.
- `src/v2/chain-context.ts` connects the services to Solana: the program client, the transaction
  runner, Privy signing for user wallets, Squads proposals and chain reads.
- `src/services/` holds the business logic, one file per area. Each money action records its
  transaction before sending, so a crash can be recovered from its signature.
- `src/webhooks.ts` is the Helius webhook (`/api/webhooks/helius`). It only triggers a reconcile; it
  never trusts the payload.

## Rules worth knowing

- Money is always USDC base units (6 decimals) as `bigint`, never floats.
- Spot state changes only after a confirmed transaction (`src/domain/spot-state.ts`).
- The program ID, USDC mint and network must agree. Fees and windows come from the on-chain config
  and each listing, not from env.
- The Solana program IDL lives in `src/chain/idl/`. Copy it in again after every program upgrade.

## Tests

```sh
npm test
```

They run against an in-memory Postgres (PGlite) with the real migrations, and mock the chain.
