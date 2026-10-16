import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { Connection, Keypair, Transaction, type PublicKey } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import { prepareChainTx, submitPreparedChainTx, type ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import { createApp } from "../src/index.js";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
import type { Db } from "../src/db/client.js";
import type { ChainContext } from "../src/v2/chain-context.js";
import { createV2Router, parseUsdc } from "../src/v2/router.js";
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
    v2Router: createV2Router({ db, reviewers: ["did:privy:reviewer_one", "@impostor_one"], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }),
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

const draft = {
  surface: "laptop",
  title: "Conference laptop lid",
  mode: "fixed",
  deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  spots: [{ price: "49.5", layout: { x: 1, y: 2, w: 10 } }],
};

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
  const seller = await signIn("seller_four");
  const response = await request(app)
    .post("/api/v2/spots/00000000-0000-0000-0000-000000000000/claim")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf);
  assert.equal(response.status, 503);
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
