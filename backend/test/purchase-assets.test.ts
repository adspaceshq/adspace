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
  rival: { did: "did:privy:rival", xUserId: "x-300", handle: "@rival" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

test("claim persists brand assets and rejects malformed ones", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf).send({ title: "Fixed", spots: [{ price: 10 }] }).expect(201);
  const spotId = created.body.spots[0].id as string;

  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ website: "not a url" }).expect(400);
  await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: "https://evil.example/logo.png" }).expect(400);
  // Oversized data URLs never reach validation over HTTP (100kb body cap) —
  // the 3MB server cap is backstop for direct repo callers only.

  const claimed = await buyer.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", buyerCsrf).send({ website: "https://buyer.example", logoUrl: LOGO }).expect(200);
  assert.equal(claimed.body.website, "https://buyer.example");
  assert.equal(claimed.body.logoUrl, LOGO);

  const listing = await request(app).get(`/api/listings/${created.body.slug}`).expect(200);
  assert.equal(listing.body.spots[0].website, "https://buyer.example");
  assert.equal(listing.body.spots[0].logoUrl, LOGO);
});

test("create persists view and hand placement", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf).send({
    title: "Placed",
    spots: [
      { price: 10 },
      { price: 20, view: "inside", x: 15, y: 73, w: 13 },
      { price: 30, view: "everywhere", x: "far", y: -5, w: 500 },
    ],
  }).expect(201);
  const [auto, placed, wild] = created.body.spots;
  assert.equal(auto.view, "lid");
  assert.equal(auto.x ?? null, null);
  assert.equal(placed.view, "inside");
  assert.equal(placed.x, 15);
  assert.equal(placed.y, 73);
  assert.equal(placed.w, 13);
  assert.equal(wild.view, "lid");
  assert.equal(wild.y, 0);
  assert.equal(wild.w, 100);
});

test("bid takeover replaces brand assets", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const rival = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const rivalCsrf = await login(rival, "rival");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf).send({ title: "Auction", mode: "auction", spots: [{ price: 10 }] }).expect(201);
  const spotId = created.body.spots[0].id as string;

  await buyer.post(`/api/spots/${spotId}/bid`).set("X-CSRF-Token", buyerCsrf).send({ amount: 10, website: "https://buyer.example", logoUrl: LOGO }).expect(200);
  const taken = await rival.post(`/api/spots/${spotId}/bid`).set("X-CSRF-Token", rivalCsrf).send({ amount: 20, website: "https://rival.example" }).expect(200);
  assert.equal(taken.body.buyer, "@rival");
  assert.equal(taken.body.website, "https://rival.example");
  assert.equal(taken.body.logoUrl, undefined);
});
