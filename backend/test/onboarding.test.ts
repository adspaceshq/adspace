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

const identity: AuthenticatedIdentity = { did: "did:privy:a", xUserId: "x-1", handle: "@a", hasX: true };

async function setup() {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async () => identity });
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/session").set("Authorization", "Bearer t").expect(200);
  assert.equal(res.body.onboarding, null);
  return { agent, csrf: res.body.csrfToken as string };
}

test("creator onboarding saves socials and shows up on /me", async () => {
  const { agent, csrf } = await setup();
  await agent.put("/api/users/me/onboarding").set("X-CSRF-Token", csrf)
    .send({ accountType: "creator", creator: { socials: { x: " @a ", youtube: "", bogus: "z" } } }).expect(200);
  const me = await agent.get("/api/auth/me").expect(200);
  assert.deepEqual(me.body.onboarding, { accountType: "creator", creator: { socials: { x: "@a" } } });
});

test("sponsor onboarding saves brand details", async () => {
  const { agent, csrf } = await setup();
  const res = await agent.put("/api/users/me/onboarding").set("X-CSRF-Token", csrf)
    .send({ accountType: "sponsor", sponsor: { brandName: "Acme", category: "crypto", website: "https://acme.xyz" } }).expect(200);
  assert.equal(res.body.sponsor.brandName, "Acme");
});

test("onboarding rejects bad input and missing CSRF", async () => {
  const { agent, csrf } = await setup();
  const put = (body: unknown, token: string | undefined = csrf) => agent.put("/api/users/me/onboarding").set("X-CSRF-Token", token ?? "").send(body as object);
  await put({ accountType: "admin" }).expect(400);
  await put({ accountType: "creator", creator: { socials: {} } }).expect(400);
  await put({ accountType: "sponsor", sponsor: { brandName: "Acme", category: "nope" } }).expect(400);
  await put({ accountType: "sponsor", sponsor: { brandName: "Acme", category: "saas", website: "javascript:alert(1)" } }).expect(400);
  await put({ accountType: "creator", creator: { socials: { x: "a" } } }, "wrong").expect(403);
});
