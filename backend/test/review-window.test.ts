import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { payoutReleased, REVIEW_WINDOW_MS } from "../src/types.js";
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
  stranger: { did: "did:privy:stranger", xUserId: "x-300", handle: "@stranger" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

async function fulfilledSpot(owner: ReturnType<typeof request.agent>, ownerCsrf: string, buyer: ReturnType<typeof request.agent>, buyerCsrf: string) {
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Done", spots: [{ price: 10 }] }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await owner.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: LOGO }).expect(200);
  await owner.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", ownerCsrf).expect(200);
  return { slug, spotId };
}

test("confirm releases early; release math honors window and disputes", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf);

  const confirmed = await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  assert.equal(typeof confirmed.body.confirmedAt, "string");
  assert.equal(payoutReleased(confirmed.body), true);
  // Idempotent.
  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  await buyer.post(`/api/spots/${spotId}/dispute`).set("X-CSRF-Token", buyerCsrf).send({ reason: "too late" }).expect(409);

  // Pure timeout math (no sleeping out the real window).
  const t0 = Date.now();
  assert.equal(REVIEW_WINDOW_MS, 3 * 86_400_000);
  assert.equal(payoutReleased({}), false);
  assert.equal(payoutReleased({ fulfilledAt: new Date(t0).toISOString() }, t0), false);
  assert.equal(payoutReleased({ fulfilledAt: new Date(t0).toISOString() }, t0 + REVIEW_WINDOW_MS + 1), true);
  assert.equal(payoutReleased({ fulfilledAt: new Date(t0).toISOString(), disputedAt: new Date(t0).toISOString() }, t0 + REVIEW_WINDOW_MS + 1), false);
});

test("dispute blocks payout, surfaces to the seller, and withdraws cleanly", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf);

  await buyer.post(`/api/spots/${spotId}/dispute`).set("X-CSRF-Token", buyerCsrf).send({ reason: "x".repeat(501) }).expect(400);
  const disputed = await buyer.post(`/api/spots/${spotId}/dispute`).set("X-CSRF-Token", buyerCsrf).send({ reason: "wrong size" }).expect(200);
  assert.equal(typeof disputed.body.disputedAt, "string");
  assert.equal(disputed.body.disputeReason, "wrong size");
  assert.equal(payoutReleased(disputed.body), false);

  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.attention.find((a: { spotId: string }) => a.spotId === spotId);
  assert.equal(row.status, "disputed");
  assert.equal(row.disputeReason, "wrong size");

  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(409);
  await buyer.post(`/api/spots/${spotId}/withdraw`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  const listing = await request(app).get(`/api/listings/${(await owner.get("/api/seller/dashboard").expect(200)).body.listings[0].slug}`).expect(200);
  assert.equal(listing.body.spots[0].disputedAt, undefined);
});

test("review actions are buyer-only on delivered spots", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const stranger = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const strangerCsrf = await login(stranger, "stranger");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf);

  await stranger.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", strangerCsrf).send({}).expect(403);
  await stranger.post(`/api/spots/${spotId}/dispute`).set("X-CSRF-Token", strangerCsrf).send({}).expect(403);
  await owner.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", ownerCsrf).send({}).expect(403);

  // Pre-delivery spots are not reviewable.
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Early", spots: [{ price: 10 }] }).expect(201);
  await buyer.post(`/api/spots/${created.body.spots[0].id}/confirm`).set("X-CSRF-Token", buyerCsrf).send({}).expect(409);
});
