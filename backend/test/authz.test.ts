import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { cookieOptions } from "../src/auth.js";
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
  attacker: { did: "did:privy:attacker", xUserId: "x-200", handle: "@attacker" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

test("mutations require a valid session-bound CSRF token", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  await agent.post("/api/listings").send({ title: "No CSRF" }).expect(403);
  await agent.post("/api/listings").set("X-CSRF-Token", "wrong").send({ title: "Wrong CSRF" }).expect(403);
  await agent.post("/api/listings").set("X-CSRF-Token", csrf).send({ title: "Allowed" }).expect(201);
});

test("non-owners cannot edit, approve, or fulfill a seller listing", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["@owner"] });
  const owner = request.agent(app);
  const attacker = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const attackerCsrf = await login(attacker, "attacker");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf).send({ title: "Owner listing", spots: [{ price: 10 }] }).expect(201);
  const slug = created.body.slug as string;
  const spotId = created.body.spots[0].id as string;
  await owner.post(`/api/listings/${slug}/approve`).set("X-CSRF-Token", ownerCsrf).expect(200);

  await attacker.patch(`/api/listings/${slug}`).set("X-CSRF-Token", attackerCsrf).send({ title: "Stolen" }).expect(403);
  await attacker.post(`/api/spots/${spotId}/claim`).set("X-CSRF-Token", attackerCsrf).send({}).expect(200);
  await attacker.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", attackerCsrf).send({}).expect(403);
  await attacker.post(`/api/spots/${spotId}/reject`).set("X-CSRF-Token", attackerCsrf).send({}).expect(403);
  await attacker.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", attackerCsrf).send({}).expect(403);

  await owner.post(`/api/spots/${spotId}/approve`).set("X-CSRF-Token", ownerCsrf).send({}).expect(200);
  const fulfilled = await owner.post(`/api/spots/${spotId}/fulfill`).set("X-CSRF-Token", ownerCsrf).send({}).expect(200);
  assert.equal(typeof fulfilled.body.fulfilledAt, "string");
});

test("seller dashboard requires authentication", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  await request(app).get("/api/seller/dashboard").expect(401);
});

test("logout revokes the persisted session", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf).send({}).expect(200);
  await agent.get("/api/auth/me").expect(401);
});

test("authentication is rate limited and production cookies are hardened", async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  assert.deepEqual(cookieOptions(), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 604_800_000 });
  process.env.NODE_ENV = previous;
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  for (let i = 0; i < 10; i++) await request(app).post("/api/auth/session").set("Authorization", "Bearer owner").expect(200);
  await request(app).post("/api/auth/session").set("Authorization", "Bearer owner").expect(429);
});
