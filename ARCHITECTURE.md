# Adspaces backend architecture

## Decision

Adspaces starts as a modular monolith with three runtime processes built from one backend package:

1. `api` - HTTP authentication, applications, public queries, and transaction intents.
2. `worker` - chain indexing, backfill, reconciliation, deadlines, and notifications.
3. `reviewer-signer` - isolated policy validation and reviewer partial-signing.

The API and worker may initially ship from the same image. The reviewer signer must have separate credentials and deployment isolation. PostgreSQL is the operational database and chain projection; Solana is authoritative for escrow and settlement.

## Fundamental boundaries

| Boundary | Authority |
|---|---|
| Identity and web session | Privy/X plus Adspaces stable user ID |
| Wallet authorization | Nonce-bound Solana wallet signature and verified user-wallet link |
| Application and moderation | PostgreSQL |
| Media metadata and integrity | PostgreSQL plus immutable object storage |
| Escrow, winner, deadlines, proof commitment, dispute, settlement | AdSpaces Solana program |
| Search and dashboards | PostgreSQL projection of finalized chain state |
| Reviewer approval | Isolated signer after deterministic policy validation |

No request handler may treat a database write as a completed payment. No indexed `confirmed` event may be presented as finalized settlement.

External systems are untrusted inputs. The API and indexer verify RPC responses against expected program ownership, discriminators, PDAs, account relationships, and finalized slots. The signer authenticates its caller independently and never trusts an API assertion without reconstructing policy inputs.

## Target repository

```text
backend/
├── migrations/                         versioned SQL; never runtime DDL
├── src/
│   ├── app.ts                          Express composition only
│   ├── server.ts                       API process entrypoint
│   ├── config.ts                       validated environment configuration
│   ├── platform/
│   │   ├── database/                   pool, transactions, migration state
│   │   ├── http/                       errors, middleware, validation
│   │   ├── observability/              logs, metrics, tracing, request IDs
│   │   └── storage/                    immutable object storage interface
│   ├── modules/
│   │   ├── identity/
│   │   │   ├── domain.ts
│   │   │   ├── repository.ts
│   │   │   ├── service.ts
│   │   │   └── routes.ts
│   │   ├── wallets/                    challenge, verification, wallet links
│   │   ├── applications/               drafts, submission, moderation, approval
│   │   ├── catalog/                    public listing/search projection queries
│   │   ├── transactions/               intent lifecycle and transaction preparation
│   │   ├── proofs/                     proof/evidence metadata and access rules
│   │   ├── disputes/                   off-chain case data and admin decisions
│   │   ├── admin/                      roles, review queues, audit trail
│   │   └── notifications/
│   ├── chain/
│   │   ├── idl/                        pinned generated artifact from contract commit
│   │   ├── client.ts                   RPC abstraction
│   │   ├── addresses.ts                PDA derivation
│   │   ├── accounts.ts                 strict account decoders
│   │   ├── instructions.ts             typed instruction construction
│   │   ├── simulation.ts
│   │   └── errors.ts                   program error mapping
│   ├── indexing/
│   │   ├── subscriber.ts               low-latency observation
│   │   ├── backfill.ts                  missed-signature recovery
│   │   ├── projector.ts                idempotent PostgreSQL writes
│   │   ├── finalizer.ts                 commitment promotion
│   │   └── reconciler.ts                full-account correction
│   ├── workers/
│   │   ├── main.ts
│   │   └── jobs/
│   └── signer/
│       ├── client.ts                    API-side signer port
│       ├── policy.ts                    deterministic message policy
│       └── server.ts                    isolated signer process
└── test/
    ├── unit/
    ├── integration/
    ├── contract/                        IDL, PDA, fee, and account-layout vectors
    └── reconstruction/                  rebuild projection from chain fixtures
```

Each module owns its routes, service/use cases, repository interface, PostgreSQL implementation, schemas, and domain types. Modules may depend on `platform` and explicit ports, never another module's database tables directly.

## Database groups

### Identity

- `users` - immutable Privy DID and X subject; mutable handle/profile.
- `sessions` - hashed expiring session tokens and CSRF secrets.
- `wallet_links` - user, wallet, cluster, verified timestamp, revoked timestamp.
- `wallet_challenges` - hashed nonce, domain, expiry, and one-time consumption.

### Off-chain workflow

- `applications` and `application_spots` - editable drafts until submission.
- `application_approvals` - immutable approved terms, canonical metadata hash, reviewer and decision.
- `media_objects` - owner, purpose, URI, SHA-256, MIME type, byte size, scan state.
- `admin_decisions` and `audit_log` - structured before/after snapshots and request IDs.
- `notifications` and `notification_deliveries` - durable delivery/outbox state.

### Chain projection

- `chain_listings`, `chain_spots`, `chain_bids`, `chain_proofs`, `chain_disputes`.
- Store addresses as unique text and token amounts/basis points as `bigint` base units.
- Every projection stores cluster, program ID, observed slot, finalized slot, commitment, raw decoded payload, and sync timestamps.
- Projection rows are replaceable from chain history and account reconciliation.

### Transaction and indexing control

- `transaction_intents` - action, actor wallet, canonical message hash, serialized message, blockhash expiry, status, signature, simulation, error.
- `chain_events` - unique `(cluster, signature, instruction_index, event_index)`.
- `chain_cursors` - subscriber/backfill progress.
- `outbox` - committed jobs emitted atomically with database state changes.

The current `listings`, `spots`, and `bids` tables are temporary mock-era models. Do not gradually add on-chain fields to them. Replace them through an explicit projection migration after the IDL and account layouts are pinned.

## Primary flows

### Listing creation

1. Creator drafts and submits an application.
2. Reviewer approves immutable commercial terms and metadata hash.
3. API verifies the user's linked wallet and creates a transaction intent.
4. Builder loads current Config and ReviewAuthority accounts, derives PDAs, constructs and simulates the exact message.
5. Isolated signer decodes the message independently, compares it with the approval, rejects extra instructions, and partially signs.
6. Creator signs client-side and submits.
7. Indexer observes, finalizes, and projects the listing. The UI reads the projection.

### Claim or bid

1. API loads finalized projection state for UX validation, then fetches current chain accounts to prevent stale construction.
2. API builds and simulates an unsigned transaction; it never accepts a client-provided instruction list.
3. Buyer signs and submits client-side.
4. Indexer records observed and finalized states separately. Auction takeover is one atomic chain transaction including the previous-bid refund.

### Proof, dispute, and settlement

1. Backend validates ownership and file policy, stores immutable bytes, canonicalizes metadata, and computes SHA-256.
2. The transaction commits the exact URI and hash.
3. Dispute and settlement interfaces follow on-chain eligibility; PostgreSQL only provides workflow context.
4. Financial UI uses finalized projection data only.

## API evolution

Keep `/api/auth/*`. The existing unversioned listing and spot routes remain the explicitly named **legacy mock API** until cutover; their request and response contract does not silently change. Introduce the on-chain protocol under versioned routes:

```text
/api/v1/wallets/challenge
/api/v1/wallets/verify
/api/v1/applications/*
/api/v1/admin/applications/*
/api/v1/transactions/*
/api/v1/listings/*
/api/v1/spots/*
/api/v1/proofs/*
/api/v1/disputes/*
/api/v1/admin/disputes/*
```

Mutation inputs are validated at the HTTP boundary. Services accept typed commands containing the authenticated user and verified wallet; repositories receive domain values, not Express requests. Errors use stable machine codes plus safe messages.

During migration:

1. Existing frontend builds continue to use the unversioned API and current `CONTRACT.md`.
2. `/api/v1/*` publishes a separate OpenAPI contract and generated frontend client.
3. Chain projection runs in shadow mode and is compared with direct finalized-chain reads before it serves users.
4. The frontend switches by a deployment flag only after fixed and auction devnet acceptance tests pass.
5. Mock-money mutations become read-only and return an explicit retirement code; they are never redirected to real transactions.
6. Unversioned routes are removed only after deployed clients no longer call them and retained data has been exported.

## Dependency rules

1. Routes depend on services, not SQL or Solana RPC.
2. Domain and services depend on repository/RPC/storage/signer interfaces.
3. PostgreSQL, Solana, storage, and signer clients implement those interfaces at the edge.
4. Chain decoders and fee arithmetic contain no HTTP or database code.
5. Generated IDL clients are pinned to a contract commit and wrapped; they do not leak through the application.
6. Frontend types are generated from an API schema rather than manually mirrored.
7. API, indexer/worker, and signer use separate database/service identities with least-privilege grants; the signer does not receive marketplace-table write access.
8. Signer calls use workload identity or mutual TLS, an allowlisted API identity, nonce/expiry protection, and a request hash bound to the exact transaction message.

## Deployment shape

Start with four deployables:

- Next.js frontend.
- Stateless API.
- Worker/indexer with singleton leases per cluster/program.
- Reviewer signer on a private network with KMS/HSM-backed key access.

Use the existing Supabase Postgres for operational state. Add an RPC provider with WebSocket and historical-signature support, immutable object storage, and a durable job mechanism. PostgreSQL advisory locks plus an outbox are sufficient initially; introduce a separate queue only when measured throughput requires it.

## Migration sequence

1. **Contract handoff:** pin IDL, source commit, program IDs, events, account layouts, error map, PDA and fee vectors.
2. **Foundation:** extract `app.ts`, configuration validation, migrations, structured errors/logging, wallet linking, module boundaries.
3. **Applications:** drafts, moderation, immutable approvals, uploads, hashing, audit log.
4. **Read path:** chain client, decoders, indexer, backfill, reconciliation, read-only catalog projection.
5. **Transaction path:** intents and builders in order: listing, spot, claim, bid, proof, dispute, refund, withdrawal, resolution.
6. **Signer isolation:** policy engine, separate deployment, key management, allowlisted caller identity, audit and rate limits.
7. **Cutover:** take a database snapshot; rebuild projections from devnet; verify account counts, PDAs, states, and balances against direct finalized-chain reads; enable shadow reads; switch the frontend behind a reversible flag; disable mock-money mutations; retain old tables read-only through an audited retention window.
8. **Operations:** deadlines, notifications, lag/mismatch alerts, restore drills, multisig authorities, mainnet audit.

Every migration step has a rollback that changes routing/configuration only. No rollback attempts to reverse finalized Solana state. Database schema changes are additive until the retention window closes.

## Non-negotiable tests

- Golden PDA, discriminator, account-layout, error-code, and fee vectors from the contract repository.
- Property tests for fee bounds, integer rounding, auction increments, and deadline ordering.
- Authorization tests for every seller, buyer, reviewer, resolver, and support boundary.
- Transaction-policy tests that inject extra instructions, swapped accounts, stale config, wrong mint, and altered terms.
- Indexer idempotency, fork/finality, missed-event backfill, and full reconstruction tests.
- End-to-end devnet flows with balance assertions for fixed, auction takeover, proof, dispute, refund, and withdrawal.

## Deliberately deferred

- Independent microservices for every domain.
- Kafka or another event bus before measured need.
- GraphQL.
- Multi-chain abstractions.
- Mainnet transaction building before an external program audit.

These can be introduced behind existing ports later. Adding them now would increase operational state without protecting an additional trust boundary.
