import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
import type { Db } from "../src/db/client.js";
import { createV2Router, parseUsdc } from "../src/v2/router.js";
import { createTestDb } from "./helpers/db.js";

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let auth: AppAuthRepository;

before(async () => {
  ({ db, close } = await createTestDb());
  auth = new AppAuthRepository(db);
  app = createApp({
    auth,
    reviewers: ["@reviewer_one"],
    v2Router: createV2Router({ db, reviewers: ["@reviewer_one"], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }),
  });
});
after(async () => close());

async function signIn(handle: string) {
  const { token, session } = await auth.createSession({
    did: `did:privy:${handle}`,
    xUserId: `x-${handle}`,
    handle: `@${handle}`,
    hasX: true,
  });
  return { cookie: `adspaces_v2_session=${token}`, csrf: session.csrfToken, id: session.user.id };
}

const draft = {
  surface: "laptop",
  title: "Conference laptop lid",
  mode: "fixed",
  deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  spots: [{ price: "49.5", layout: { x: 1, y: 2, w: 10 } }],
};

test("parses USDC amounts into base units", () => {
  assert.equal(parseUsdc("49.5", "price"), 49_500_000n);
  assert.equal(parseUsdc("1", "price"), 1_000_000n);
  assert.throws(() => parseUsdc("1.0000001", "price"));
  assert.throws(() => parseUsdc("-1", "price"));
});

test("public listing feed works without a session", async () => {
  const response = await request(app).get("/api/v2/listings");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { items: [], hasMore: false });
});

test("creating a draft needs a session and a CSRF token", async () => {
  assert.equal((await request(app).post("/api/v2/listings").send(draft)).status, 401);
  const seller = await signIn("seller_one");
  const noCsrf = await request(app).post("/api/v2/listings").set("Cookie", seller.cookie).send(draft);
  assert.equal(noCsrf.status, 403);
  const created = await request(app)
    .post("/api/v2/listings")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send(draft);
  assert.equal(created.status, 201);
  assert.equal(created.body.listing.state, "draft");
  assert.equal(created.body.spots[0].price, "49500000");
});

test("invalid drafts return a readable 400", async () => {
  const seller = await signIn("seller_two");
  const response = await request(app)
    .post("/api/v2/listings")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send({ ...draft, spots: [{ price: "abc", layout: { x: 1, y: 2, w: 3 } }] });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /USDC amount/);
});

test("only reviewers see the review queue", async () => {
  const seller = await signIn("seller_three");
  assert.equal((await request(app).get("/api/v2/review/queue").set("Cookie", seller.cookie)).status, 403);
  const reviewer = await signIn("reviewer_one");
  const queue = await request(app).get("/api/v2/review/queue").set("Cookie", reviewer.cookie);
  assert.equal(queue.status, 200);
  assert.ok(Array.isArray(queue.body));
});

test("on-chain actions report 503 when the chain is not configured", async () => {
  const seller = await signIn("seller_four");
  const response = await request(app)
    .post("/api/v2/spots/00000000-0000-0000-0000-000000000000/claim")
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf);
  assert.equal(response.status, 503);
});

test("protocol admin actions are refused for non-admins", async () => {
  const reviewer = await signIn("reviewer_one");
  const response = await request(app)
    .post("/api/v2/admin/pause")
    .set("Cookie", reviewer.cookie)
    .set("X-CSRF-Token", reviewer.csrf)
    .send({ paused: true });
  assert.equal(response.status, 403);
});

test("dashboards require a session and return bigint money as strings", async () => {
  assert.equal((await request(app).get("/api/v2/me/dashboard/creator")).status, 401);
  const seller = await signIn("dash_seller");
  const creator = await request(app).get("/api/v2/me/dashboard/creator").set("Cookie", seller.cookie);
  assert.equal(creator.status, 200);
  assert.equal(creator.body.stats.earned, "0");
  const sponsor = await request(app).get("/api/v2/me/dashboard/sponsor").set("Cookie", seller.cookie);
  assert.equal(sponsor.status, 200);
  assert.equal(sponsor.body.stats.inEscrow, "0");
  assert.equal((await request(app).get("/api/v2/review/summary").set("Cookie", seller.cookie)).status, 403);
});

test("creators can edit their draft and read it back; others cannot", async () => {
  const seller = await signIn("edit_seller");
  const created = await request(app).post("/api/v2/listings").set("Cookie", seller.cookie).set("X-CSRF-Token", seller.csrf).send(draft);
  const id = created.body.listing.id;
  const edited = await request(app)
    .patch(`/api/v2/listings/${id}`)
    .set("Cookie", seller.cookie)
    .set("X-CSRF-Token", seller.csrf)
    .send({ ...draft, title: "Edited lid", spots: [{ price: "3", layout: { x: 40, y: 40, w: 20 } }] });
  assert.equal(edited.status, 200);
  const own = await request(app).get(`/api/v2/me/listings/${id}`).set("Cookie", seller.cookie);
  assert.equal(own.body.title, "Edited lid");
  assert.equal(own.body.spots[0].price, "3000000");
  const stranger = await signIn("edit_stranger");
  assert.equal((await request(app).get(`/api/v2/me/listings/${id}`).set("Cookie", stranger.cookie)).status, 404);
});
