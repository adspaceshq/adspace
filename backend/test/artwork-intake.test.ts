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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const ART = "data:image/png;base64,aW50YWtl";
const FINAL = "data:image/png;base64,ZmluYWw=";

async function soldSpot(owner: ReturnType<typeof request.agent>, ownerCsrf: string, buyer: ReturnType<typeof request.agent>, buyerCsrf: string, extra: object = {}) {
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: " uniforms", spots: [{ price: 10 }], ...extra }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await owner.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: ART }).expect(200);
  await owner.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  return { slug, spotId };
}

test("buyer submits final artwork on a sold spot; seller sees it as received", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { slug, spotId } = await soldSpot(owner, ownerCsrf, buyer, buyerCsrf);

  const done = await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf)
    .send({ logoUrl: FINAL, website: "https://buyer.example" }).expect(200);
  assert.equal(done.body.logoUrl, FINAL);
  assert.equal(done.body.website, "https://buyer.example");
  assert.equal(typeof done.body.artworkSubmittedAt, "string");

  const listing = await request(app).get(`/api/listings/${slug}`).expect(200);
  assert.equal(listing.body.spots[0].artworkSubmittedAt, done.body.artworkSubmittedAt);

  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.attention.find((a: { spotId: string }) => a.spotId === spotId);
  assert.equal(row.artworkReceived, true);
});

test("intake is buyer-only, sold-only, and needs substance", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const stranger = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const strangerCsrf = await login(stranger, "stranger");
  const { spotId } = await soldSpot(owner, ownerCsrf, buyer, buyerCsrf);

  await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf).send({}).expect(400);
  await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: "https://evil.example/a.png" }).expect(400);
  await stranger.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", strangerCsrf).send({ logoUrl: FINAL }).expect(403);
  await owner.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", ownerCsrf).send({ logoUrl: FINAL }).expect(403);
});

test("intake on a merely claimed spot is refused", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Pending", spots: [{ price: 10 }] }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await owner.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({}).expect(200);
  const refused = await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: FINAL }).expect(409);
  assert.equal(refused.body.error, "artwork intake opens once the spot is sold");
});

test("artwork window locks after artworkClose; garbage dates rejected at submit", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");

  await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Sloppy", artworkClose: "sometime", spots: [{ price: 10 }] }).expect(400);

  const { spotId } = await soldSpot(owner, ownerCsrf, buyer, buyerCsrf, {
    artworkClose: new Date(Date.now() + 1000).toISOString(),
  });
  await sleep(1300);
  const refused = await buyer.post(`/api/spots/${spotId}/artwork`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: FINAL }).expect(409);
  assert.equal(refused.body.error, "artwork window has closed");
});
