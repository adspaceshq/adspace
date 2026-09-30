import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import type { AuthRepository, StoredSession } from "../src/db.js";
import type { AuthenticatedIdentity } from "../src/types.js";

class FakeAuthRepository implements AuthRepository {
  private sessions = new Map<string, StoredSession>();
  private seq = 0;
  async createSession(identity: AuthenticatedIdentity) {
    const token = `session-${++this.seq}`;
    const csrfToken = `csrf-${this.seq}`;
    const expiresAt = new Date(Date.now() + 60_000);
    const user = { id: `user-${identity.xUserId}`, did: identity.did, handle: identity.handle, name: identity.name, avatar: identity.avatar, hasX: true };
    this.sessions.set(token, { user, csrfToken, expiresAt });
    return { token, session: { user, csrfToken, expiresAt } };
  }
  async readSession(token: string | undefined) { return token ? this.sessions.get(token) : undefined; }
  async destroySession(token: string | undefined) { if (token) this.sessions.delete(token); }
}

const identities: Record<string, AuthenticatedIdentity> = {
  seller: { did: "did:privy:seller", xUserId: "x-1", handle: "@seller", hasX: true },
  buyer: { did: "did:privy:buyer", xUserId: "x-2", handle: "@buyer", hasX: true },
  rival: { did: "did:privy:rival", xUserId: "x-3", handle: "@rival", hasX: true },
};
const LOGO = "data:image/png;base64,bG9nbw==";

type Agent = ReturnType<typeof request.agent>;
async function login(agent: Agent, who: keyof typeof identities) {
  const res = await agent.post("/api/auth/session").set("Authorization", `Bearer ${who}`).expect(200);
  return res.body.csrfToken as string;
}

async function publish(app: ReturnType<typeof createApp>, seed: object) {
  const seller = request.agent(app);
  const sellerCsrf = await login(seller, "seller");
  const created = await seller.post("/api/listings").set("X-CSRF-Token", sellerCsrf).send(seed).expect(201);
  const slug = created.body.slug as string;
  await seller.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", sellerCsrf).expect(200);
  await seller.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", sellerCsrf).send({ version: "v1" }).expect(200);
  return { seller, sellerCsrf, slug, spotId: created.body.spots[0].id as string };
}

test("sponsor dashboard requires authentication", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (t) => identities[t], reviewers: ["@seller"] });
  await request(app).get("/api/sponsor/dashboard").expect(401);
});

test("sponsor dashboard walks a claimed spot from pending to delivered", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (t) => identities[t], reviewers: ["@seller"] });
  const { seller, sellerCsrf, slug, spotId } = await publish(app, { title: " sponsor run ", spots: [{ price: 100, currency: "USD" }] });
  const buyer = request.agent(app);
  const buyerCsrf = await login(buyer, "buyer");

  const empty = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.deepEqual(empty.body, { summary: { active: 0, pendingApproval: 0, awaitingArtwork: 0, delivering: 0, committed: 0, currency: "USD" }, campaigns: [] });

  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: LOGO }).expect(200);
  const claimed = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.equal(claimed.body.campaigns.length, 1);
  assert.equal(claimed.body.campaigns[0].status, "pending");
  assert.equal(claimed.body.campaigns[0].listingSlug, slug);
  assert.equal(claimed.body.campaigns[0].sellerHandle, "@seller");
  assert.equal(claimed.body.summary.pendingApproval, 1);
  assert.equal(claimed.body.summary.committed, 100);

  await seller.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", sellerCsrf).expect(200);
  const sold = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.equal(sold.body.campaigns[0].status, "sold");
  assert.equal(sold.body.campaigns[0].artworkDue, true);
  assert.equal(sold.body.summary.awaitingArtwork, 1);

  await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: LOGO }).expect(200);
  const art = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.equal(art.body.campaigns[0].artworkDue, false);
  assert.ok(art.body.campaigns[0].artworkSubmittedAt);

  await seller.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", sellerCsrf).expect(200);
  await seller.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", sellerCsrf).send({ photos: [LOGO], postUrl: "https://x.com/seller/status/1" }).expect(200);
  const delivered = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.equal(delivered.body.campaigns[0].status, "delivered");
  assert.equal(delivered.body.campaigns[0].proofPhotos.length, 1);
  assert.equal(delivered.body.campaigns[0].proofPost, "https://x.com/seller/status/1");
  assert.equal(delivered.body.summary.delivering, 1);

  await buyer.post(`/api/spots/${spotId}/confirm`).set("X-CSRF-Token", buyerCsrf).expect(200);
  const confirmed = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.ok(confirmed.body.campaigns[0].confirmedAt);
});

test("an outbid sponsor keeps a refunded row, others see nothing", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (t) => identities[t], reviewers: ["@seller"] });
  const { seller, sellerCsrf, spotId } = await publish(app, { title: " auction lid ", mode: "auction", spots: [{ price: 50, currency: "USD" }] });
  const buyer = request.agent(app);
  const buyerCsrf = await login(buyer, "buyer");
  const rival = request.agent(app);
  const rivalCsrf = await login(rival, "rival");

  await buyer.post(`/api/spots/${spotId}/bid`).set("X-CSRF-Token", buyerCsrf).send({ amount: 50, logoUrl: LOGO }).expect(200);
  assert.equal((await buyer.get("/api/sponsor/dashboard")).body.campaigns[0].status, "sold");

  await rival.post(`/api/spots/${spotId}/bid`).set("X-CSRF-Token", rivalCsrf).send({ amount: 60, logoUrl: LOGO }).expect(200);
  const outbid = await buyer.get("/api/sponsor/dashboard").expect(200);
  assert.equal(outbid.body.campaigns[0].status, "refunded");
  assert.equal(outbid.body.campaigns[0].amount, 50);
  assert.equal(outbid.body.summary.active, 0);
  assert.equal(outbid.body.summary.committed, 0);
  const held = await rival.get("/api/sponsor/dashboard").expect(200);
  assert.equal(held.body.campaigns[0].status, "sold");
  assert.equal(held.body.campaigns[0].amount, 60);
  assert.equal(held.body.summary.committed, 60);
  await seller.get("/api/sponsor/dashboard").expect(200).expect((res) => assert.equal(res.body.campaigns.length, 0));
});
