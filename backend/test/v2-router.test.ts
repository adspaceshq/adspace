import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { eq } from "drizzle-orm";
import { Connection, Keypair, Transaction, type PublicKey } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import { prepareChainTx, submitPreparedChainTx, type ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import { squadsProposalInstructions, squadsVault } from "../src/chain/squads.js";
import { createApp } from "../src/index.js";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
import type { Db } from "../src/db/client.js";
import { listings } from "../src/db/schema.js";
import type { ChainContext } from "../src/v2/chain-context.js";
import { createV2Router, parseUsdc } from "../src/v2/router.js";
import { unsubscribeToken } from "../src/services/unsubscribe.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing } from "./helpers/seed.js";

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let auth: AppAuthRepository;

before(async () => {
  ({ db, close } = await createTestDb());
  auth = new AppAuthRepository(db);
  app = createApp({
    v2Router: createV2Router({
      db,
      reviewers: ["did:privy:reviewer_one", "@impostor_one"],
      termsVersion: "test",
      metadataBaseUrl: "https://adspaces.test",
      unsubscribeSecret: "test-unsubscribe",
    }),
  });
});
after(async () => close());

async function signIn(handle: string) {
  const { token, session } = await auth.createSession({
    did: `did:privy:${handle}`,
    xUserId: `x-${handle}`,
    handle: `@${handle}`,
    hasX: true,
  });
  return { cookie: `adspaces_v2_session=${token}`, csrf: session.csrfToken, id: session.user.id };
}

async function signInVerified(handle: string) {
  const { token, session } = await auth.createSession({
    did: `did:privy:${handle}`,
    xUserId: `x-${handle}`,
    handle: `@${handle}`,
    email: `${handle}@example.com`,
    hasX: true,
  });
  return { cookie: `adspaces_v2_session=${token}`, csrf: session.csrfToken, id: session.user.id };
}

const draft = {
  surface: "laptop",
  title: "Conference laptop lid",
  mode: "fixed",
  deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  spots: [{ price: "49.5", layout: { x: 1, y: 2, w: 10 } }],
};

test("email unsubscribe works without a session, one click from the mail client or from the page", async () => {
  const user = await signIn("unsub_route");
  const token = unsubscribeToken("test-unsubscribe", user.id, "bidding")!;
  const prefs = async () => (await request(app).get("/api/v2/me/notification-prefs").set("Cookie", user.cookie)).body;

  const status = await request(app).get("/api/v2/email/unsubscribe").query({ token });
  assert.equal(status.status, 200);
  assert.deepEqual(status.body, { category: "bidding", subscribed: true });

  // RFC 8058: the client POSTs form data with the token in the URL, and no cookies.
  const oneClick = await request(app).post(`/api/v2/email/unsubscribe?token=${encodeURIComponent(token)}`).type("form").send("List-Unsubscribe=One-Click");
  assert.equal(oneClick.status, 200);
  assert.equal((await prefs()).bidding, false);

  const back = await request(app).post("/api/v2/email/resubscribe").send({ token });
  assert.deepEqual(back.body, { category: "bidding", subscribed: true });
  assert.equal((await prefs()).bidding, true);

  assert.equal((await request(app).post("/api/v2/email/unsubscribe").send({ token: `${token}x` })).status, 404);
  assert.equal((await request(app).post("/api/v2/email/unsubscribe")).status, 404);
});

test("parses USDC amounts into base units", () => {
  assert.equal(parseUsdc("49.5", "price"), 49_500_000n);
  assert.equal(parseUsdc("1", "price"), 1_000_000n);
  assert.throws(() => parseUsdc("1.0000001", "price"));
  assert.throws(() => parseUsdc("-1", "price"));
});

test("public listing feed works without a session", async () => {
  const response = await request(app).get("/api/v2/listings");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { items: [], hasMore: false });
});

test("creating a draft needs a session and a CSRF token", async () => {
  assert.equal((await request(app).post("/api/v2/listings").send(draft)).status, 401);
  const seller = await signIn("seller_one");
  const noCsrf = await request(app).post("/api/v2/listings").set("Cookie", seller.cookie).send(draft);
  assert.equal(noCsrf.status, 403);
  const created = await request(app)
    .post("/api/v2/listings")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send(draft);
  assert.equal(created.status, 201);
  assert.equal(created.body.listing.state, "draft");
  assert.equal(created.body.spots[0].price, "49500000");
});

test("invalid drafts return a readable 400", async () => {
  const seller = await signIn("seller_two");
  const response = await request(app)
    .post("/api/v2/listings")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send({ ...draft, spots: [{ price: "abc", layout: { x: 1, y: 2, w: 3 } }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /USDC amount/);
});

test("only reviewers see the review queue", async () => {
  const seller = await signIn("seller_three");
  assert.equal((await request(app).get("/api/v2/review/queue").set("Cookie", seller.cookie)).status, 403);
  const reviewer = await signIn("reviewer_one");
  const queue = await request(app).get("/api/v2/review/queue").set("Cookie", reviewer.cookie);
  assert.equal(queue.status, 200);
  assert.ok(Array.isArray(queue.body));
});

test("on-chain actions report 503 when the chain is not configured", async () => {
  const buyer = await signInVerified("buyer_four");
  const response = await request(app)
    .post("/api/v2/spots/00000000-0000-0000-0000-000000000000/claim")
    .set("Cookie", buyer.cookie)
    .set("X-CSRF-Token", buyer.csrf)
    .send({ termsVersion: "test" });
  assert.equal(response.status, 503);
});

test("claims and bids need a verified email and the current terms version", async () => {
  const path = (action: string) => `/api/v2/spots/00000000-0000-0000-0000-000000000000/${action}`;
  const unverified = await signIn("unverified_buyer");
  for (const action of ["claim", "bid"]) {
    const response = await request(app).post(path(action)).set("Cookie", unverified.cookie).set("X-CSRF-Token", unverified.csrf).send({ termsVersion: "test" });
    assert.equal(response.status, 403);
    assert.match(response.body.error, /verify your email/);
  }
  const buyer = await signInVerified("verified_buyer");
  const post = (action: string, body: object) => request(app).post(path(action)).set("Cookie", buyer.cookie).set("X-CSRF-Token", buyer.csrf).send(body);
  for (const action of ["claim", "bid"]) {
    const missing = await post(action, { amount: "10" });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /agree to the terms/);
    const stale = await post(action, { amount: "10", termsVersion: "old" });
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /terms have changed/);
  }
});

test("finishing onboarding over the API needs the current terms version", async () => {
  const user = await signInVerified("onboard_terms");
  const put = (body: object) => request(app).put("/api/v2/me/onboarding").set("Cookie", user.cookie).set("X-CSRF-Token", user.csrf).send(body);
  const sponsor = { accountType: "sponsor", sponsor: { brandName: "Acme", category: "crypto" } };
  assert.equal((await put(sponsor)).status, 400);
  assert.equal((await put({ ...sponsor, termsVersion: "old" })).status, 409);
  const saved = await put({ ...sponsor, termsVersion: "test" });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.accountType, "sponsor");
  // Edits afterwards (settings) don't send it.
  assert.equal((await put({ ...sponsor, sponsor: { brandName: "Acme 2", category: "crypto" } })).status, 200);
});

test("public status reports the pause flag, cluster and terms version, cached briefly", async () => {
  const plain = await request(app).get("/api/v2/status");
  assert.equal(plain.status, 200);
  assert.deepEqual(plain.body, { paused: false, cluster: "devnet", termsVersion: "test" });

  let paused = true;
  let reads = 0;
  let failing = false;
  const chain = {
    readProtocolStatus: async () => {
      reads += 1;
      if (failing) throw new Error("rpc down");
      return { paused };
    },
  } as unknown as ChainContext;
  const build = (statusCacheMs: number) =>
    createApp({ v2Router: createV2Router({ db, chain, reviewers: [], termsVersion: "v9", cluster: "mainnet-beta", metadataBaseUrl: "https://adspaces.test", statusCacheMs }) });

  const cached = build(60_000);
  const first = await request(cached).get("/api/v2/status");
  assert.equal(first.status, 200);
  assert.deepEqual(first.body, { paused: true, cluster: "mainnet-beta", termsVersion: "v9" });
  assert.match(first.headers["cache-control"], /max-age=60/);
  paused = false;
  assert.equal((await request(cached).get("/api/v2/status")).body.paused, true);
  assert.equal(reads, 1);

  // A paused protocol refuses purchases before any chain work.
  const buyer = await signInVerified("paused_buyer");
  const claim = await request(cached)
    .post("/api/v2/spots/00000000-0000-0000-0000-000000000000/claim")
    .set("Cookie", buyer.cookie)
    .set("X-CSRF-Token", buyer.csrf)
    .send({ termsVersion: "v9" });
  assert.equal(claim.status, 409);
  assert.match(claim.body.error, /trading is paused/);

  // Uncached: every request reads the chain, and an RPC failure serves the last known value.
  const fresh = build(0);
  assert.equal((await request(fresh).get("/api/v2/status")).body.paused, false);
  failing = true;
  const stale = await request(fresh).get("/api/v2/status");
  assert.equal(stale.status, 200);
  assert.equal(stale.body.paused, false);
  // With nothing cached yet, the failure is a 503.
  assert.equal((await request(build(0)).get("/api/v2/status")).status, 503);
});

test("protocol admin actions are refused for non-admins", async () => {
  const reviewer = await signIn("reviewer_one");
  const response = await request(app)
    .post("/api/v2/admin/pause")
    .set("Cookie", reviewer.cookie)
    .set("X-CSRF-Token", reviewer.csrf)
    .send({ paused: true });
  assert.equal(response.status, 403);
});

test("dashboards require a session and return bigint money as strings", async () => {
  assert.equal((await request(app).get("/api/v2/me/dashboard/creator")).status, 401);
  const seller = await signIn("dash_seller");
  const creator = await request(app).get("/api/v2/me/dashboard/creator").set("Cookie", seller.cookie);
  assert.equal(creator.status, 200);
  assert.equal(creator.body.stats.earned, "0");
  const sponsor = await request(app).get("/api/v2/me/dashboard/sponsor").set("Cookie", seller.cookie);
  assert.equal(sponsor.status, 200);
  assert.equal(sponsor.body.stats.inEscrow, "0");
  assert.equal((await request(app).get("/api/v2/review/summary").set("Cookie", seller.cookie)).status, 403);
});

test("creators can edit their draft and read it back; others cannot", async () => {
  const seller = await signIn("edit_seller");
  const created = await request(app).post("/api/v2/listings").set("Cookie", seller.cookie).set("X-CSRF-Token", seller.csrf).send(draft);
  const id = created.body.listing.id;
  const edited = await request(app)
    .patch(`/api/v2/listings/${id}`)
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send({ ...draft, title: "Edited lid", spots: [{ price: "3", layout: { x: 40, y: 40, w: 20 } }] });
  assert.equal(edited.status, 200);
  const own = await request(app).get(`/api/v2/me/listings/${id}`).set("Cookie", seller.cookie);
  assert.equal(own.body.title, "Edited lid");
  assert.equal(own.body.spots[0].price, "3000000");
  const stranger = await signIn("edit_stranger");
  assert.equal((await request(app).get(`/api/v2/me/listings/${id}`).set("Cookie", stranger.cookie)).status, 404);
});

test("roles match only ids or Privy DIDs, never a handle someone can claim", async () => {
  // "@impostor_one" is configured as a reviewer by handle; holding that handle must not grant the role.
  const impostor = await signIn("impostor_one");
  assert.equal((await request(app).get("/api/v2/review/queue").set("Cookie", impostor.cookie)).status, 403);
  const me = await request(app).get("/api/v2/auth/me").set("Cookie", impostor.cookie);
  assert.equal(me.body.isReviewer, false);
});

test("logout revokes the session server-side", async () => {
  const user = await signIn("logout_one");
  assert.equal((await request(app).get("/api/v2/auth/me").set("Cookie", user.cookie)).status, 200);
  assert.equal((await request(app).post("/api/v2/auth/logout").set("Cookie", user.cookie)).status, 403);
  assert.equal((await request(app).post("/api/v2/auth/logout").set("Cookie", user.cookie).set("X-CSRF-Token", user.csrf)).status, 200);
  assert.equal((await request(app).get("/api/v2/auth/me").set("Cookie", user.cookie)).status, 401);
});

test("session exchange is rate limited", async () => {
  const limited = createApp({ v2Router: createV2Router({ db, reviewers: [], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }) });
  for (let i = 0; i < 20; i++) assert.equal((await request(limited).post("/api/v2/auth/session")).status, 401);
  assert.equal((await request(limited).post("/api/v2/auth/session")).status, 429);
});

test("rent reclaim is admin-only and the creator close routes are gone", async () => {
  const platform = keypairSigner(Keypair.generate());
  const sent: ChainTxRequest[] = [];
  const chain = {
    program: createProgram(new Connection("http://127.0.0.1:8899")),
    mint: Keypair.generate().publicKey,
    reviewer: platform,
    rentPayer: platform,
    runTx: fakeRunTx(db, sent),
    readVaultBalance: async () => 0n,
    accountExists: async () => true,
    readLamports: async (addresses: PublicKey[]) => addresses.map(() => 2_000_000),
  } as unknown as ChainContext;
  const adminApp = createApp({
    v2Router: createV2Router({
      db,
      chain,
      reviewers: ["did:privy:rent_reviewer"],
      admins: ["did:privy:rent_admin"],
      termsVersion: "test",
      metadataBaseUrl: "https://adspaces.test",
    }),
  });
  const HOUR = 60 * 60 * 1000;
  const expired = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const selling = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });

  // Creators used to sign their own closes; those routes no longer exist.
  const creator = await auth.createSession({ did: expired.seller.user.privyDid, xUserId: "x-rent-creator", handle: `@${expired.seller.user.handle}`, hasX: true });
  const creatorCookie = `adspaces_v2_session=${creator.token}`;
  for (const path of [`/api/v2/spots/${expired.spot.id}/close`, `/api/v2/listings/${expired.listing.id}/close`]) {
    const response = await request(adminApp).post(path).set("Cookie", creatorCookie).set("X-CSRF-Token", creator.session.csrfToken);
    assert.equal(response.status, 404);
  }

  for (const handle of ["rent_reviewer", "rent_user"]) {
    const user = await signIn(handle);
    assert.equal((await request(adminApp).get("/api/v2/admin/rent").set("Cookie", user.cookie)).status, 403);
    const post = (path: string) => request(adminApp).post(path).set("Cookie", user.cookie).set("X-CSRF-Token", user.csrf).send({ force: true });
    assert.equal((await post(`/api/v2/admin/spots/${expired.spot.id}/close`)).status, 403);
    assert.equal((await post(`/api/v2/admin/listings/${expired.listing.id}/close`)).status, 403);
  }
  assert.equal(sent.length, 0);

  const admin = await signIn("rent_admin");
  const adminPost = (path: string, body: object = {}) =>
    request(adminApp).post(path).set("Cookie", admin.cookie).set("X-CSRF-Token", admin.csrf).send(body);
  const report = await request(adminApp).get("/api/v2/admin/rent").set("Cookie", admin.cookie);
  assert.equal(report.status, 200);
  const reported = report.body.spots.find((spot: { id: string }) => spot.id === expired.spot.id);
  assert.equal(reported?.lamports, 4_000_000);
  assert.ok(!report.body.spots.some((spot: { id: string }) => spot.id === selling.spot.id));

  const closedSpot = await adminPost(`/api/v2/admin/spots/${expired.spot.id}/close`);
  assert.equal(closedSpot.status, 200);
  assert.equal(closedSpot.body.spot.state, "cancelled");
  assert.equal(sent[0].actorId, admin.id);

  assert.equal((await adminPost(`/api/v2/admin/spots/${selling.spot.id}/close`)).status, 409);
  assert.equal((await adminPost(`/api/v2/admin/listings/${selling.listing.id}/close`)).status, 409);
  assert.equal((await adminPost(`/api/v2/admin/spots/${selling.spot.id}/close`, { force: true })).status, 200);

  const closedListing = await adminPost(`/api/v2/admin/listings/${expired.listing.id}/close`);
  assert.equal(closedListing.status, 200);
  assert.equal(closedListing.body.listing.state, "closed");
});

test("guardian pause prepare and submit are admin-only and send what the guardian signed", async () => {
  const guardian = Keypair.generate();
  let paused = false;
  const sentRaw: Buffer[] = [];
  const connection = {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
    getBlockHeight: async () => 10,
    sendRawTransaction: async (raw: Buffer) => {
      sentRaw.push(raw);
      paused = true;
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  } as unknown as Connection;
  const status = () => ({
    authority: Keypair.generate().publicKey,
    treasury: Keypair.generate().publicKey,
    feeBps: 250,
    paused,
    disputeTimeoutSeconds: 3 * 24 * 60 * 60,
    pauseGuardian: guardian.publicKey,
  });
  const chain = {
    program: createProgram(connection),
    readProtocolStatus: async () => status(),
    prepareTx: (request: Parameters<ChainContext["prepareTx"]>[0]) => prepareChainTx(db, connection, request),
    submitTx: (chainTxId: string, signed: string) => submitPreparedChainTx(db, connection, chainTxId, signed),
  } as unknown as ChainContext;
  const guardianApp = createApp({
    v2Router: createV2Router({
      db,
      chain,
      reviewers: ["did:privy:guardian_reviewer"],
      admins: ["did:privy:guardian_admin"],
      termsVersion: "test",
      metadataBaseUrl: "https://adspaces.test",
    }),
  });
  const post = (who: { cookie: string; csrf: string }, path: string, body: object) =>
    request(guardianApp).post(`/api/v2/admin/guardian-pause/${path}`).set("Cookie", who.cookie).set("X-CSRF-Token", who.csrf).send(body);

  for (const handle of ["guardian_reviewer", "guardian_user"]) {
    const who = await signIn(handle);
    assert.equal((await post(who, "prepare", { wallet: guardian.publicKey.toBase58() })).status, 403);
    assert.equal((await post(who, "submit", { chainTxId: "00000000-0000-0000-0000-000000000000", transaction: "AA==" })).status, 403);
  }

  const admin = await signIn("guardian_admin");
  assert.equal((await post(admin, "prepare", { wallet: Keypair.generate().publicKey.toBase58() })).status, 409);
  assert.equal((await post(admin, "prepare", {})).status, 400);
  const prepared = await post(admin, "prepare", { wallet: guardian.publicKey.toBase58() });
  assert.equal(prepared.status, 201);
  const tx = Transaction.from(Buffer.from(prepared.body.transaction, "base64"));
  tx.partialSign(guardian);
  const submitted = await post(admin, "submit", { chainTxId: prepared.body.chainTxId, transaction: tx.serialize().toString("base64") });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.body.paused, true);
  assert.equal(typeof submitted.body.signature, "string");
  assert.equal(sentRaw.length, 1);
});

test("multisig admin proposals report when they expire, from the cluster clock and SQUADS_PROPOSAL_TTL_HOURS", async () => {
  const platform = keypairSigner(Keypair.generate());
  const multisigKey = Keypair.generate().publicKey;
  const vault = squadsVault(multisigKey);
  const sent: ChainTxRequest[] = [];
  const memos: Array<string | undefined> = [];
  let paused = true;
  const CLUSTER_NOW = 1_800_000_000;
  const chain = {
    program: createProgram(new Connection("http://127.0.0.1:8899")),
    reviewer: platform,
    runTx: fakeRunTx(db, sent),
    readProtocolStatus: async () => ({
      authority: vault,
      treasury: vault,
      feeBps: 250,
      paused,
      disputeTimeoutSeconds: 3 * 24 * 60 * 60,
      pauseGuardian: null,
    }),
    readClusterTime: async () => CLUSTER_NOW,
    adminMessageTtlHours: 12,
    squads: {
      multisig: multisigKey,
      vault,
      proposer: platform,
      propose: async (instructions: Parameters<typeof squadsProposalInstructions>[0]["instructions"], memo?: string) => {
        memos.push(memo);
        return squadsProposalInstructions({ multisig: multisigKey, proposer: platform.publicKey, transactionIndex: 3n, instructions, memo });
      },
      proposalStatus: async () => "active",
    },
  } as unknown as ChainContext;
  const adminApp = createApp({
    v2Router: createV2Router({ db, chain, reviewers: [], admins: ["did:privy:ttl_admin"], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }),
  });
  const admin = await signIn("ttl_admin");
  const post = (path: string, body: object) => request(adminApp).post(path).set("Cookie", admin.cookie).set("X-CSRF-Token", admin.csrf).send(body);
  const expiry = new Date((CLUSTER_NOW + 12 * 3600) * 1000).toISOString();

  const resume = await post("/api/v2/admin/pause", { paused: false });
  assert.equal(resume.status, 200);
  assert.equal(resume.body.paused, true);
  assert.equal(resume.body.pending.transactionIndex, 3);
  assert.equal(resume.body.pending.validUntil, expiry);
  assert.match(memos[0] ?? "", /resume protocol \(expires /);

  const timeout = await post("/api/v2/admin/dispute-timeout", { seconds: 2 * 24 * 60 * 60 });
  assert.equal(timeout.status, 200);
  assert.equal(timeout.body.pending.validUntil, expiry);

  // Running: no resume proposal is built (the program would reject an unpause with ConfigMismatch).
  paused = false;
  const running = await post("/api/v2/admin/pause", { paused: false });
  assert.equal(running.status, 200);
  assert.equal(running.body.pending, null);
  assert.equal(running.body.signature, null);
  assert.equal(sent.length, 2);
});

test("listings delivering more than 90 days out need an admin to approve over the API", async () => {
  const chain = { configFeeFloorBps: async () => 250 } as unknown as ChainContext;
  const reviewApp = createApp({
    v2Router: createV2Router({
      db,
      chain,
      reviewers: ["did:privy:long_reviewer"],
      admins: ["did:privy:long_admin"],
      termsVersion: "test",
      metadataBaseUrl: "https://adspaces.test",
    }),
  });
  const DAY = 24 * 60 * 60 * 1000;
  const seeded = await seedListing(db, { deadline: new Date(Date.now() + DAY), deliveryDueAt: new Date(Date.now() + 120 * DAY) });
  await db.update(listings).set({ state: "in_review", chainAddress: null }).where(eq(listings.id, seeded.listing.id));
  const approve = { action: "approve", fees: { feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 } };

  const reviewer = await signIn("long_reviewer");
  const detail = await request(reviewApp).get(`/api/v2/review/listings/${seeded.listing.id}`).set("Cookie", reviewer.cookie);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.needsAdminApproval, true);
  assert.equal(detail.body.adminApprovalAfterDays, 90);
  const queue = await request(reviewApp).get("/api/v2/review/queue").set("Cookie", reviewer.cookie);
  assert.equal(queue.body.find((item: { id: string }) => item.id === seeded.listing.id)?.needsAdminApproval, true);

  const refused = await request(reviewApp)
    .post(`/api/v2/review/listings/${seeded.listing.id}`)
    .set("Cookie", reviewer.cookie)
    .set("X-CSRF-Token", reviewer.csrf)
    .send(approve);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, "listings longer than 90 days need an admin to approve");

  const admin = await signIn("long_admin");
  const approved = await request(reviewApp)
    .post(`/api/v2/review/listings/${seeded.listing.id}`)
    .set("Cookie", admin.cookie)
    .set("X-CSRF-Token", admin.csrf)
    .send(approve);
  assert.equal(approved.status, 200);
  assert.equal(approved.body.state, "approved");
});

test("adopting listings after a reviewer key rotation is admin-only and reports adopted and skipped", async () => {
  const reviewer = keypairSigner(Keypair.generate());
  const former = Keypair.generate().publicKey;
  const sent: ChainTxRequest[] = [];
  const HOUR = 60 * 60 * 1000;
  const legacy = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const payers = new Map<string, PublicKey>([[legacy.listing.chainAddress!, former]]);
  let authority = Keypair.generate().publicKey;
  const chain = {
    program: createProgram(new Connection("http://127.0.0.1:8899")),
    mint: Keypair.generate().publicKey,
    reviewer,
    rentPayer: reviewer,
    runTx: fakeRunTx(db, sent),
    readReviewAuthority: async () => authority,
    // Listings other tests seeded already belong to the current key.
    readListingRentPayers: async (keys: PublicKey[]) => keys.map((key) => payers.get(key.toBase58()) ?? reviewer.publicKey),
    readLamports: async (addresses: PublicKey[]) => addresses.map(() => 1_000_000),
  } as unknown as ChainContext;
  const adoptApp = createApp({
    v2Router: createV2Router({
      db,
      chain,
      reviewers: ["did:privy:adopt_reviewer"],
      admins: ["did:privy:adopt_admin"],
      termsVersion: "test",
      metadataBaseUrl: "https://adspaces.test",
    }),
  });
  const post = (who: { cookie: string; csrf: string }) =>
    request(adoptApp).post("/api/v2/admin/listings/adopt").set("Cookie", who.cookie).set("X-CSRF-Token", who.csrf).send({});

  assert.equal((await request(adoptApp).post("/api/v2/admin/listings/adopt")).status, 401);
  for (const handle of ["adopt_reviewer", "adopt_user"]) assert.equal((await post(await signIn(handle))).status, 403);
  const admin = await signIn("adopt_admin");

  // The rent report shows what is still on the former key.
  const rent = await request(adoptApp).get("/api/v2/admin/rent").set("Cookie", admin.cookie);
  assert.equal(rent.status, 200);
  assert.equal(rent.body.serverRentPayer, reviewer.publicKey.toBase58());

  // Before the review authority points at the server key, nothing is sent.
  const early = await post(admin);
  assert.equal(early.status, 409);
  assert.match(early.body.error, /not the on-chain review authority/);
  assert.equal(sent.length, 0);

  authority = reviewer.publicKey;
  const adopted = await post(admin);
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.reviewer, reviewer.publicKey.toBase58());
  assert.deepEqual(adopted.body.adopted.map((item: { listingId: string }) => item.listingId), [legacy.listing.id]);
  assert.equal(adopted.body.adopted[0].previousRentPayer, former.toBase58());
  assert.ok(adopted.body.skipped.every((item: { reason: string }) => item.reason === "already on the current key"));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].actorId, admin.id);
});

test("the review summary lists stale Squads proposals with what to cancel", async () => {
  const reviewApp = createApp({
    v2Router: createV2Router({ db, reviewers: ["did:privy:stale_reviewer"], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }),
  });
  const reviewer = await signIn("stale_reviewer");
  const summary = await request(reviewApp).get("/api/v2/review/summary").set("Cookie", reviewer.cookie);
  assert.equal(summary.status, 200);
  assert.ok(Array.isArray(summary.body.staleProposals));
  assert.equal(typeof summary.body.counts.staleProposals, "number");
});

test("support: sign-in required, owners and the team only, team queue for reviewers", async () => {
  const user = await signIn("support_user");
  const stranger = await signIn("support_stranger");
  const reviewer = await signIn("reviewer_one");
  const ticket = { topic: "bug", subject: "claim button does nothing", message: "I press claim on a spot and nothing happens at all." };

  await request(app).post("/api/v2/support/tickets").send(ticket).expect(401);
  await request(app).post("/api/v2/support/tickets").set("Cookie", user.cookie).send(ticket).expect(403);
  const created = await request(app).post("/api/v2/support/tickets").set("Cookie", user.cookie).set("x-csrf-token", user.csrf).send(ticket).expect(201);
  const id = created.body.id as string;

  await request(app).get(`/api/v2/support/tickets/${id}`).set("Cookie", user.cookie).expect(200);
  await request(app).get(`/api/v2/support/tickets/${id}`).set("Cookie", stranger.cookie).expect(404);
  const staffView = await request(app).get(`/api/v2/support/tickets/${id}`).set("Cookie", reviewer.cookie).expect(200);
  assert.equal(staffView.body.user.handle, "support_user");

  await request(app).get("/api/v2/review/support").set("Cookie", user.cookie).expect(403);
  const queue = await request(app).get("/api/v2/review/support?state=open").set("Cookie", reviewer.cookie).expect(200);
  assert.ok((queue.body as Array<{ id: string }>).some((row) => row.id === id));

  await request(app).post(`/api/v2/support/tickets/${id}/messages`).set("Cookie", reviewer.cookie).set("x-csrf-token", reviewer.csrf).send({ message: "fixed, try again now" }).expect(201);
  const mine = await request(app).get("/api/v2/support/tickets").set("Cookie", user.cookie).expect(200);
  assert.equal(mine.body[0].state, "answered");
});
