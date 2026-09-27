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

const LOGO = "data:image/png;base64,iVBORw0KGgo=";
const PHOTO1 = "data:image/jpeg;base64,cGhvdG8x";
const PHOTO2 = "data:image/jpeg;base64,cGhvdG8y";
const POST = "https://x.com/owner/status/123";

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

test("seller pins proof after fulfilling; buyer reads it on the listing", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { slug, spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf);

  const pinned = await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO1, PHOTO2], postUrl: POST }).expect(200);
  assert.deepEqual(pinned.body.proofPhotos, [PHOTO1, PHOTO2]);
  assert.equal(pinned.body.proofPost, POST);

  // Replace semantics: a second upload swaps the set.
  const swapped = await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO2] }).expect(200);
  assert.deepEqual(swapped.body.proofPhotos, [PHOTO2]);
  assert.equal(swapped.body.proofPost, undefined);

  const listing = await request(app).get(`/api/listings/${slug}`).expect(200);
  assert.deepEqual(listing.body.spots[0].proofPhotos, [PHOTO2]);

  // Proof clears the dashboard cue.
  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  assert.ok(!dashboard.body.attention.some((a: { spotId: string }) => a.spotId === spotId));
});

test("proof needs fulfillment first and a seller behind it", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const stranger = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const strangerCsrf = await login(stranger, "stranger");

  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Early", spots: [{ price: 10 }] }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await owner.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await owner.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: LOGO }).expect(200);
  await owner.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);

  // Sold but not yet fulfilled: proof waits for delivery.
  const early = await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO1] }).expect(409);
  assert.equal(early.body.error, "fulfill the spot before uploading proof");

  await owner.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await stranger.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", strangerCsrf)
    .send({ photos: [PHOTO1] }).expect(403);
  await buyer.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", buyerCsrf)
    .send({ photos: [PHOTO1] }).expect(403);

  // ...and the dashboard cues the missing proof as delivered work.
  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.attention.find((a: { spotId: string }) => a.spotId === spotId);
  assert.equal(row.status, "delivered");
});

test("proof validates photos and the post link", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { spotId } = await fulfilledSpot(owner, ownerCsrf, buyer, buyerCsrf);

  await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf).send({ photos: [] }).expect(400);
  await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO1, PHOTO1, PHOTO1, PHOTO1, PHOTO1, PHOTO1] }).expect(400);
  await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: ["https://example.com/a.png"] }).expect(400);
  await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO1], postUrl: "https://example.com/post" }).expect(400);
  await owner.post(`/api/spots/${spotId}/proof`).set("X-CSRF-Token", ownerCsrf)
    .send({ photos: [PHOTO1], postUrl: "http://x.com/owner/status/1" }).expect(400);
});
