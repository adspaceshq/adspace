import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
import type { Db } from "../src/db/client.js";
import { createV2Router } from "../src/v2/router.js";
import { createTestDb } from "./helpers/db.js";
import { eq } from "drizzle-orm";
import { users } from "../src/db/schema.js";

let db: Db;
let close: () => Promise<void>;
let app: ReturnType<typeof createApp>;
let auth: AppAuthRepository;

before(async () => {
  ({ db, close } = await createTestDb());
  auth = new AppAuthRepository(db);
  app = createApp({
    auth,
    v2Router: createV2Router({ db, reviewers: [], admins: ["did:privy:owner_admin"], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }),
  });
});
after(async () => close());

async function signIn(handle: string, options: { x?: boolean; email?: boolean } = {}) {
  const { x = true, email = true } = options;
  const { token, session } = await auth.createSession({
    did: `did:privy:${handle}`,
    ...(x ? { xUserId: `x-${handle}` } : {}),
    handle: x ? `@${handle}` : handle,
    hasX: x,
    ...(email ? { email: `${handle}@example.com` } : {}),
  });
  return { cookie: `adspaces_v2_session=${token}`, csrf: session.csrfToken, id: session.user.id };
}

const me = async (user: { cookie: string }) => (await request(app).get("/api/v2/auth/me").set("Cookie", user.cookie)).body as { isReviewer: boolean; isAdmin: boolean };

test("admins add and remove team members by handle; the grant is stored by id", async () => {
  const owner = await signIn("owner_admin");
  const helper = await signIn("helper_one");
  const write = (path: string, user: typeof owner) => request(app).post(path).set("Cookie", user.cookie).set("X-CSRF-Token", user.csrf);

  assert.deepEqual(await me(owner), { ...(await me(owner)), isReviewer: true, isAdmin: true });
  assert.equal((await me(helper)).isReviewer, false);

  // Non-admins can't manage the team.
  assert.equal((await write("/api/v2/admin/team", helper).send({ handle: "@helper_one", role: "admin" })).status, 403);
  // Unknown handles and bad roles are refused.
  assert.equal((await write("/api/v2/admin/team", owner).send({ handle: "@nobody_here", role: "reviewer" })).status, 404);
  assert.equal((await write("/api/v2/admin/team", owner).send({ handle: "@helper_one", role: "boss" })).status, 400);

  const added = await write("/api/v2/admin/team", owner).send({ handle: "@Helper_One", role: "reviewer" });
  assert.equal(added.status, 200);
  assert.equal(added.body[0].userId, helper.id);
  assert.equal(added.body[0].grantedByHandle, "owner_admin");
  assert.deepEqual([(await me(helper)).isReviewer, (await me(helper)).isAdmin], [true, false]);
  assert.equal((await request(app).get("/api/v2/review/queue").set("Cookie", helper.cookie)).status, 200);

  // Promote, then the new admin can manage the team but cannot remove themselves.
  await write("/api/v2/admin/team", owner).send({ handle: "helper_one", role: "admin" });
  assert.equal((await me(helper)).isAdmin, true);
  assert.equal((await request(app).delete(`/api/v2/admin/team/${helper.id}`).set("Cookie", helper.cookie).set("X-CSRF-Token", helper.csrf)).status, 400);

  // Removal takes effect immediately.
  const removed = await request(app).delete(`/api/v2/admin/team/${helper.id}`).set("Cookie", owner.cookie).set("X-CSRF-Token", owner.csrf);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body, []);
  assert.equal((await me(helper)).isReviewer, false);

  // The owner admin comes from env and is never in the team table, so it can't be removed in the app.
  assert.equal((await me(owner)).isAdmin, true);
});

test("team roles need a linked X account and a verified email, and stop working if either is lost", async () => {
  const owner = await signIn("owner_admin");
  const noX = await signIn("no_x_user", { x: false });
  const noEmail = await signIn("no_email_user", { email: false });
  const member = await signIn("member_two");
  const add = (handle: string) => request(app).post("/api/v2/admin/team").set("Cookie", owner.cookie).set("X-CSRF-Token", owner.csrf).send({ handle, role: "reviewer" });

  assert.match((await add("no_x_user")).body.error, /sign in with X/);
  assert.match((await add("no_email_user")).body.error, /verify their email/);
  assert.equal((await add("member_two")).status, 200);
  assert.equal((await me(member)).isReviewer, true);

  // Losing verification switches the role off without removing them.
  await db.update(users).set({ emailVerifiedAt: null }).where(eq(users.id, member.id));
  assert.equal((await me(member)).isReviewer, false);
  assert.equal((await request(app).get("/api/v2/review/queue").set("Cookie", member.cookie)).status, 403);
  assert.ok(noX && noEmail);
});
