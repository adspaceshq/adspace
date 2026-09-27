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
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const IMAGE = "data:image/png;base64,iVBORw0KGgo=";

test("new listings land as submitted: hidden from marketplace, listed in dashboard", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  const created = await agent.post("/api/listings").set("X-CSRF-Token", csrf)
    .send({ title: "Fresh", image: IMAGE, spots: [{ price: 10 }] }).expect(201);
  assert.equal(created.body.status, "submitted");
  assert.equal(created.body.image, IMAGE);

  const summaries = await request(app).get("/api/listings").expect(200);
  assert.ok(!summaries.body.some((s: { slug: string }) => s.slug === created.body.slug));

  const direct = await request(app).get(`/api/listings/${created.body.slug}`).expect(200);
  assert.equal(direct.body.status, "submitted");

  const dashboard = await agent.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.listings.find((l: { slug: string }) => l.slug === created.body.slug);
  assert.equal(row.status, "submitted");
});

test("listing image must be an inline upload under ~3 MB", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  await agent.post("/api/listings").set("X-CSRF-Token", csrf)
    .send({ title: "Remote", image: "https://example.com/photo.png", spots: [{ price: 10 }] }).expect(400);
  await agent.post("/api/listings").set("X-CSRF-Token", csrf)
    .send({ title: "Huge", image: `data:image/png;base64,${"A".repeat(3_000_001)}`, spots: [{ price: 10 }] }).expect(400);
});

test("submissions stay editable while pending review", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token] });
  const agent = request.agent(app);
  const csrf = await login(agent, "owner");
  const created = await agent.post("/api/listings").set("X-CSRF-Token", csrf)
    .send({ title: "Draft title", spots: [{ price: 10 }] }).expect(201);
  const updated = await agent.patch(`/api/listings/${created.body.slug}`).set("X-CSRF-Token", csrf)
    .send({ title: "Final title", story: "My story" }).expect(200);
  assert.equal(updated.body.title, "Final title");
  assert.equal(updated.body.status, "submitted");
});
