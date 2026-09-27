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
  attacker: { did: "did:privy:attacker", xUserId: "x-300", handle: "@attacker" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

async function createListing(agent: ReturnType<typeof request.agent>, csrf: string, body: object) {
  const created = await agent.post("/api/listings").set("X-CSRF-Token", csrf).send(body).expect(201);
  return created.body as { slug: string; spots: Array<{ id: string }> };
}

test("submissions stay hidden until review; close withdraws, reopen resubmits", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { slug, spots } = await createListing(owner, ownerCsrf, { title: "Toggle me", spots: [{ price: 10 }] });

  // Fresh submissions are pending review: out of the marketplace, unbuyable.
  const created = await request(app).get(`/api/listings/${slug}`).expect(200);
  assert.equal(created.body.status, "submitted");
  const summaries = await request(app).get("/api/listings").expect(200);
  assert.ok(!summaries.body.some((s: { slug: string }) => s.slug === slug));
  await buyer.post(`/api/spots/${spots[0].id}/claim`).set("X-CSRF-Token", buyerCsrf).send({}).expect(409);

  // Close withdraws; reopen resubmits — neither path self-publishes.
  const closed = await owner.post(`/api/listings/${slug}/close`).set("X-CSRF-Token", ownerCsrf).expect(200);
  assert.equal(closed.body.status, "closed");
  const resubmitted = await owner.post(`/api/listings/${slug}/reopen`).set("X-CSRF-Token", ownerCsrf).expect(200);
  assert.equal(resubmitted.body.status, "submitted");
  await owner.post(`/api/listings/${slug}/reopen`).set("X-CSRF-Token", ownerCsrf).expect(409);
  await buyer.post(`/api/spots/${spots[0].id}/claim`).set("X-CSRF-Token", buyerCsrf).send({}).expect(409);
});

test("delete removes clean listings but refuses ones with buyers or bids", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");

  const clean = await createListing(owner, ownerCsrf, { title: "Clean", spots: [{ price: 10 }] });
  await owner.delete(`/api/listings/${clean.slug}`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await request(app).get(`/api/listings/${clean.slug}`).expect(404);

  const busy = await createListing(owner, ownerCsrf, { title: "Busy", mode: "auction", spots: [{ price: 10 }] });
  await owner.post(`/api/listings/${busy.slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);
  await buyer.post(`/api/spots/${busy.spots[0].id}/bid`).set("X-CSRF-Token", buyerCsrf).send({ amount: 10 }).expect(200);
  await owner.delete(`/api/listings/${busy.slug}`).set("X-CSRF-Token", ownerCsrf).expect(409);
});

test("non-owners cannot close, reopen, or delete", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const attacker = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const attackerCsrf = await login(attacker, "attacker");
  const { slug } = await createListing(owner, ownerCsrf, { title: "Mine", spots: [{ price: 10 }] });

  await attacker.post(`/api/listings/${slug}/close`).set("X-CSRF-Token", attackerCsrf).expect(403);
  await attacker.post(`/api/listings/${slug}/reopen`).set("X-CSRF-Token", attackerCsrf).expect(403);
  await attacker.delete(`/api/listings/${slug}`).set("X-CSRF-Token", attackerCsrf).expect(403);
});
