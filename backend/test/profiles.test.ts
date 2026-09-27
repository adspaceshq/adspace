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
  owner: { did: "did:privy:owner", xUserId: "x-100", handle: "@owner", name: "Owner", avatar: "https://x.test/o.png" },
  attacker: { did: "did:privy:attacker", xUserId: "x-200", handle: "@attacker" },
};

const WALLET = "7xKXtg2CW87d97TXJSDV7iSNL4w8Bvqf9f4kR3mP6jD";

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

test("login auto-creates a public profile, even with zero listings", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  await login(agent, "owner");
  const res = await agent.get("/api/users/owner").expect(200);
  assert.equal(res.body.handle, "@owner");
  assert.equal(res.body.displayName, "Owner");
  assert.equal(res.body.bio, "");
  assert.equal(res.body.verified, true);
  assert.ok(!("payoutWallet" in res.body));
});

test("profile lookup ignores @ and case; unknown handles 404", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  await login(agent, "owner");
  await agent.get("/api/users/@OWNER").expect(200);
  await agent.get("/api/users/nobody").expect(404);
});

test("owner updates bio and payout wallet; validation rejects bad input", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  const updated = await agent.patch("/api/users/me").set("X-CSRF-Token", csrf)
    .send({ bio: "Ironman kit + frame.", payoutWallet: WALLET, admin: true }).expect(200);
  assert.equal(updated.body.bio, "Ironman kit + frame.");
  assert.equal(updated.body.payoutWallet, WALLET);
  await agent.patch("/api/users/me").set("X-CSRF-Token", csrf)
    .send({ payoutWallet: "not-a-wallet" }).expect(400);
  await agent.patch("/api/users/me").set("X-CSRF-Token", csrf)
    .send({ bio: "x".repeat(281) }).expect(400);
});

test("profile PATCH requires session CSRF", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  await request(app).patch("/api/users/me").send({ bio: "hi" }).expect(401);
  const agent = request.agent(app);
  await login(agent, "owner");
  await agent.patch("/api/users/me").send({ bio: "hi" }).expect(403);
});

test("payout wallet is owner-only", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const owner = request.agent(app);
  const attacker = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  await login(attacker, "attacker");
  await owner.patch("/api/users/me").set("X-CSRF-Token", ownerCsrf).send({ payoutWallet: WALLET }).expect(200);
  const ownView = await owner.get("/api/users/owner").expect(200);
  assert.equal(ownView.body.payoutWallet, WALLET);
  const otherView = await attacker.get("/api/users/owner").expect(200);
  assert.ok(!("payoutWallet" in otherView.body));
  assert.equal(otherView.body.bio, "");
});
