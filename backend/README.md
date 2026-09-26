# Adspaces API (TypeScript + Express)

Listings, claims, and bids. X identity is verified here: the browser logs in with Privy,
then the access token is exchanged for an httpOnly session cookie. Mutations never trust
a name from the request body.

## Run

```sh
cp .env.example .env   # set PRIVY_APP_ID + PRIVY_APP_SECRET
npm install
npm run dev            # :8080 with reload
```

`PRIVY_APP_SECRET` is required for login. Get it from
[dashboard.privy.io](https://dashboard.privy.io) → Configuration → App settings → Basics.
Never put it in the frontend env.

## Docker

```sh
npm run build
docker build -t adspaces-api .
docker run -p 8080:8080 --env-file .env adspaces-api
```

Endpoints: see `../CONTRACT.md`.

The runtime entrypoint is `src/server.ts`; `src/index.ts` only composes the Express app so tests and future workers can import it without starting a listener. Startup validates database, frontend, pool, session, and Solana configuration before accepting traffic. Chain health remains `pending-idl` until the pinned contract IDL is integrated.
