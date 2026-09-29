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
  reviewer: { did: "did:privy:reviewer", xUserId: "x-900", handle: "@reviewer" },
  stranger: { did: "did:privy:stranger", xUserId: "x-300", handle: "@stranger" },
  buyer: { did: "did:privy:buyer", xUserId: "x-200", handle: "@buyer" },
};

async function login(agent: ReturnType<typeof request.agent>, token: keyof typeof identities) {
  const response = await agent.post("/api/auth/session").set("Authorization", `Bearer ${token}`).expect(200);
  return response.body.csrfToken as string;
}

const reviewApp = (published?: string[]) => createApp({
  auth: new FakeAuthRepository(),
  verifyToken: async (token) => identities[token],
  reviewers: ["@reviewer"],
  ...(published ? { listingPublisher: { publish: async (listing) => { published.push(listing.slug); } } } : {}),
});

test("sessions disclose reviewer status for reviewer-only UI", async () => {
  const app = reviewApp();
  const reviewer = request.agent(app);
  const stranger = request.agent(app);
  const reviewerMe = await reviewer.post("/api/auth/session").set("Authorization", "Bearer reviewer").expect(200);
  assert.equal(reviewerMe.body.isReviewer, true);
  const strangerMe = await stranger.post("/api/auth/session").set("Authorization", "Bearer stranger").expect(200);
  assert.equal(strangerMe.body.isReviewer, false);
  const refetched = await reviewer.get("/api/auth/me").expect(200);
  assert.equal(refetched.body.isReviewer, true);
});

test("review queue is reviewer-only", async () => {
  const app = reviewApp();
  await request(app).get("/api/review/queue").expect(401);
  const stranger = request.agent(app);
  const strangerCsrf = await login(stranger, "stranger");
  await stranger.get("/api/review/queue").expect(403);
  await stranger.post("/api/listings/nope/approve").set("X-CSRF-Token", strangerCsrf).send({}).expect(403);
});

test("approve stages, accept-terms goes live, then buyers can claim", async () => {
  const published: string[] = [];
  const app = reviewApp(published);
  const owner = request.agent(app);
  const reviewer = request.agent(app);
  const buyer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const reviewerCsrf = await login(reviewer, "reviewer");
  const buyerCsrf = await login(buyer, "buyer");

  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Worthy", spots: [{ price: 10 }] }).expect(201);

  const queue = await reviewer.get("/api/review/queue").expect(200);
  assert.ok(queue.body.some((l: { slug: string }) => l.slug === created.body.slug));

  const staged = await reviewer.post(`/api/listings/${created.body.slug}/approve`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(200);
  assert.equal(staged.body.status, "approved");
  assert.deepEqual(published, []);

  // Approved is still hidden and unbuyable — terms come first.
  const summaries = await request(app).get("/api/listings").expect(200);
  assert.ok(!summaries.body.some((s: { slug: string }) => s.slug === created.body.slug));
  await buyer.post(`/api/spots/${created.body.spots[0].id}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: "data:image/png;base64,iVBORw0KGgo=" }).expect(409);

  // Stale versions and strangers are refused; the owner pins the live version.
  await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v0" }).expect(400);
  await buyer.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", buyerCsrf).send({ version: "v1" }).expect(403);
  const live = await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  assert.deepEqual(published, [created.body.slug]);
  assert.equal(live.body.status, "active");
  assert.equal(live.body.termsVersion, "v1");
  assert.equal(typeof live.body.termsAcceptedAt, "string");

  const listed = await request(app).get("/api/listings").expect(200);
  assert.ok(listed.body.some((s: { slug: string }) => s.slug === created.body.slug));

  const claimed = await buyer.post(`/api/spots/${created.body.spots[0].id}/claim`).set("X-CSRF-Token", buyerCsrf).send({ logoUrl: "data:image/png;base64,iVBORw0KGgo=" }).expect(200);
  assert.equal(claimed.body.buyer, "@buyer");

  // Accepting a live listing is a no-op; approving twice is a 409.
  await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  assert.deepEqual(published, [created.body.slug]);
  await reviewer.post(`/api/listings/${created.body.slug}/approve`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(409);
  await reviewer.post("/api/listings/missing/approve").set("X-CSRF-Token", reviewerCsrf).send({}).expect(404);

  const drained = await reviewer.get("/api/review/queue").expect(200);
  assert.ok(!drained.body.some((l: { slug: string }) => l.slug === created.body.slug));
});

test("accept-terms requires approval and the current terms", async () => {
  const app = reviewApp();
  const owner = request.agent(app);
  const ownerCsrf = await login(owner, "owner");

  const terms = await request(app).get("/api/terms").expect(200);
  assert.equal(terms.body.version, "v1");
  assert.match(terms.body.text, /Demo only/);

  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Early", spots: [{ price: 10 }] }).expect(201);
  await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(409);
  await owner.post("/api/listings/missing/accept-terms").set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(404);
});

test("reopening an approved listing resubmits it", async () => {
  const app = reviewApp();
  const owner = request.agent(app);
  const reviewer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const reviewerCsrf = await login(reviewer, "reviewer");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Second look", spots: [{ price: 10 }] }).expect(201);
  await reviewer.post(`/api/listings/${created.body.slug}/approve`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(200);
  const resubmitted = await owner.post(`/api/listings/${created.body.slug}/reopen`).set("X-CSRF-Token", ownerCsrf).expect(200);
  assert.equal(resubmitted.body.status, "submitted");
});

test("reject closes with a reason the seller can see", async () => {
  const app = reviewApp();
  const owner = request.agent(app);
  const reviewer = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const reviewerCsrf = await login(reviewer, "reviewer");

  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Not yet", spots: [{ price: 10 }] }).expect(201);

  await reviewer.post(`/api/listings/${created.body.slug}/reject`).set("X-CSRF-Token", reviewerCsrf)
    .send({ reason: "x".repeat(501) }).expect(400);
  const rejected = await reviewer.post(`/api/listings/${created.body.slug}/reject`).set("X-CSRF-Token", reviewerCsrf)
    .send({ reason: "Add a real photo first." }).expect(200);
  assert.equal(rejected.body.status, "closed");
  assert.equal(rejected.body.reviewNote, "Add a real photo first.");

  const dashboard = await owner.get("/api/seller/dashboard").expect(200);
  const row = dashboard.body.listings.find((l: { slug: string }) => l.slug === created.body.slug);
  assert.equal(row.reviewNote, "Add a real photo first.");

  // Rejecting twice (now closed, not submitted) is a 409.
  await reviewer.post(`/api/listings/${created.body.slug}/reject`).set("X-CSRF-Token", reviewerCsrf).send({}).expect(409);
});

test("reviewers can match by stable user ID, surviving handle renames", async () => {
  const app = createApp({ auth: new FakeAuthRepository(), verifyToken: async (token) => identities[token], reviewers: ["user-x-100"] });
  const owner = request.agent(app);
  const ownerCsrf = await login(owner, "owner");
  const created = await owner.post("/api/listings").set("X-CSRF-Token", ownerCsrf)
    .send({ title: "Mine", spots: [{ price: 10 }] }).expect(201);
  // Self-approval is permitted while reviewers are named individuals (no RBAC yet).
  const staged = await owner.post(`/api/listings/${created.body.slug}/approve`).set("X-CSRF-Token", ownerCsrf).send({}).expect(200);
  assert.equal(staged.body.status, "approved");
  const live = await owner.post(`/api/listings/${created.body.slug}/accept-terms`).set("X-CSRF-Token", ownerCsrf).send({ version: "v1" }).expect(200);
  assert.equal(live.body.status, "active");
});
