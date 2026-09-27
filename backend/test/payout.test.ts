import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { Store } from "../src/store.js";
import type { AuthRepository, StoredSession } from "../src/db.js";
import type { AuthenticatedIdentity } from "../src/types.js";

class FakeAuthRepository implements AuthRepository {
  private sessions = new Map<string, StoredSession>();
  private seq = 0;
  async createSession(identity: AuthenticatedIdentity) {
    const token = `session-${++this.seq}`;
    const csrfToken = `csrf-${this.seq}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const user = { id: `user-${identity.xUserId}`, did: identity.did, handle: identity.handle, name: identity.name, avatar: identity.avatar };
    this.sessions.set(token, { user, csrfToken, expiresAt });
    return { token, session: { user, csrfToken, expiresAt } };
  }
  async readSession(token: string | undefined) { return token ? this.sessions.get(token) : undefined; }
  async destroySession(token: string | undefined) { if (token) this.sessions.delete(token); }
}

const identities: Record<string, AuthenticatedIdentity> = {
  owner: { did: "did:privy:owner", xUserId: "x-100", handle: "@owner" },
  buyer: { did: "did:privy:buyer", xUserId: "x-200", handle: "@buyer" },
  reviewer: { did: "did:privy:reviewer", xUserId: "x-900", handle: "@reviewer" },
  stranger: { did: "did:privy:stranger", xUserId: "x-300", handle: "@stranger" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const WALLET = "7xKXtg2CW87d97TXJSDV7iSNL4w8Bvqf9f4kR3mP6jD";

function paidApp() {
  const store = new Store();
  store.registerSellerWallet("user-x-100", WALLET);
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@reviewer"], store });
  return app;
}

async function fulfilledSpot(owner: ReturnType<typeof request.agent>, ownerCsrf: string, buyer: ReturnType<typeof request.agent>, buyerCsrf: string, price = 10, reviewer?: ReturnType<typeof request.agent>, reviewerCsrf?: string) {
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Done", spots: [{ price }] }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await (reviewer ?? owner).post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", reviewerCsrf ?? ownerCsrf).expect(200);
  await owner.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: LOGO }).expect(200);
  await owner.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", ownerCsrf).expect(200);
  return { slug, spotId };
}

test("unreleased spots refuse pay; the payable queue lists them once confirmed", async () => {
  const app = paidApp();
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const reviewer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const reviewerCsrf = await login(reviewer, "reviewer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf, 10, reviewer, reviewerCsrf);

  const early = await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(409);
  assert.equal(early.body.error, "spot is not released for payout");
  assert.deepEqual(await reviewer.get("/api/review/payable").expect(200).then((r) => r.body), []);

  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  const queue = await reviewer.get("/api/review/payable").expect(200);
  assert.equal(queue.body.length, 1);
  assert.equal(queue.body[0].spotId, spotId);
  assert.equal(queue.body[0].buyer, "@buyer");
});

test("pay snapshots amount, fee, destination and is idempotent", async () => {
  const app = paidApp();
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const reviewer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const reviewerCsrf = await login(reviewer, "reviewer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf, 10, reviewer, reviewerCsrf);
  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);

  const paid = await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({ reference: "sent via Phantom" }).expect(200);
  assert.equal(typeof paid.body.paidAt, "string");
  assert.equal(paid.body.payoutAmount, 10);
  assert.equal(paid.body.payoutFee, 0);
  assert.equal(paid.body.payoutReference, "sent via Phantom");
  assert.equal(paid.body.payoutDestination, WALLET);

  const again = await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({ reference: "other" }).expect(200);
  assert.equal(again.body.payoutReference, "sent via Phantom");

  const queue = await reviewer.get("/api/review/payable").expect(200);
  assert.ok(!queue.body.some((i: { spotId: string }) => i.spotId === spotId));

  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  assert.equal(dashboard.body.summary.paidOut, 10);
  assert.equal(dashboard.body.listings[0].paid, 1);
});

test("disputes block pay until withdrawn; platform fee splits the snapshot", async () => {
  process.env.PLATFORM_FEE_BPS = "500";
  try {
    const app = paidApp();
    const owner = request.agent(app);
    const buyer = request.agent(app);
    const reviewer = request.agent(app);
    const ownerCsrf = await login(owner, "owner");
    const buyerCsrf = await login(buyer, "buyer");
    const reviewerCsrf = await login(reviewer, "reviewer");
    const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf, 100, reviewer, reviewerCsrf);

    await buyer.post(`/api/spots/${spotId}/dispute`).set("X-CSRF-Token", buyerCsrf).send({ reason: "wrong" }).expect(200);
    await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(409);
    await buyer.post(`/api/spots/${spotId}/withdraw`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
    await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
    const paid = await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(200);
    assert.equal(paid.body.payoutAmount, 100);
    assert.equal(paid.body.payoutFee, 5);
    const dashboard = await owner.get("/api/seller/dashboard").expect(200);
    assert.equal(dashboard.body.summary.paidOut, 95);
  } finally {
    delete process.env.PLATFORM_FEE_BPS;
  }
});

test("pay is reviewer-only and needs a seller wallet", async () => {
  const strangerApp = paidApp();
  const stranger = request.agent(strangerApp);
  const strangerCsrf = await login(stranger, "stranger");
  await stranger.post("/api/spots/nope/pay").set("X-CSRF-Token", strangerCsrf).send({}).expect(403);
  await stranger.get("/api/review/payable").expect(403);

  // No registered wallet for this seller: the ops check fires before release math.
  const bare = new Store();
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@reviewer"], store: bare });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const reviewer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const reviewerCsrf = await login(reviewer, "reviewer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf, 10, reviewer, reviewerCsrf);
  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  const missing = await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(409);
  assert.equal(missing.body.error, "seller payout wallet is not set");

  await reviewer.post("/api/spots/nope/pay").set("X-CSRF-Token", reviewerCsrf).send({}).expect(404);
  await reviewer.post(`/api/spots/${spotId}/pay`).set("X-CSRF-Token", reviewerCsrf).send({ reference: "x".repeat(201) }).expect(400);
});
