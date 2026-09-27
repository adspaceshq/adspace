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
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function goLive(agent: ReturnType<typeof request.agent>, csrf: string, body: object) {
  const created = await agent.post("/api/listings").set("X-CSRF-Token", csrf).send(body).expect(201);
  const slug = created.body.slug as string;
  await agent.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", csrf).expect(200);
  await agent.post(`/api/listings/${slug}/accept-terms`).set("X-CSRF-Token", csrf).send({ version: "v1" }).expect(200);
  return created.body as { slug: string; spots: Array<{ id: string }> };
}

test("ended fixed listing leaves the marketplace but keeps its link, refusing claims", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { slug, spots } = await goLive(owner, ownerCsrf, {
    title: "Brief", spots: [{ price: 10 }], deadline: new Date(Date.now() + 1000).toISOString(),
  });

  // Live for its one second: visible and claimable.
  const before = await request(app).get("/api/listings").expect(200);
  assert.ok(before.body.some((s: { slug: string }) => s.slug === slug));

  await sleep(1300);

  const after = await request(app).get("/api/listings").expect(200);
  assert.ok(!after.body.some((s: { slug: string }) => s.slug === slug));
  const direct = await request(app).get(`/api/listings/${slug}`).expect(200);
  assert.equal(direct.body.status, "active");
  const refused = await buyer.post(`/api/spots/${spots[0].id}/claim`).set("X-CSRF-Token", buyerCsrf).send({}).expect(409);
  assert.equal(refused.body.error, "listing has ended");
});

test("accepting terms after the deadline refuses with close-and-relist", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Too slow", spots: [{ price: 10 }], deadline: new Date(Date.now() + 1000).toISOString() }).expect(201);
  await owner.post(`/api/listings/${created.body.slug}/approve`).set("X-CSRF-Token", ownerCsrf).send({}).expect(200);
  await sleep(1300);
  const refused = await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(409);
  assert.equal(refused.body.error, "deadline has passed — close and relist");
});

test("ended auction refuses bids and the dashboard still reports the deadline", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const buyerCsrf = await login(buyer, "buyer");
  const { slug, spots } = await goLive(owner, ownerCsrf, {
    title: "Flash", mode: "auction", spots: [{ price: 10 }], deadline: new Date(Date.now() + 1000).toISOString(),
  });

  await sleep(1300);

  const refused = await buyer.post(`/api/spots/${spots[0].id}/bid`).set("X-CSRF-Token", buyerCsrf).send({ amount: 10 }).expect(409);
  assert.equal(refused.body.error, "listing has ended");

  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.listings.find((l: { slug: string }) => l.slug === slug);
  assert.equal(row.status, "active");
  assert.equal(typeof row.deadline, "string");
});
