import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
import { termsAcceptances } from "../src/db/schema.js";
import type { Db } from "../src/db/client.js";
import { createTestDb } from "./helpers/db.js";

let db: Db;
let close: () => Promise<void>;
let repo: AppAuthRepository;

before(async () => {
  ({ db, close } = await createTestDb());
  repo = new AppAuthRepository(db);
});
after(async () => close());

const xIdentity = {
  did: "did:privy:alice",
  xUserId: "x-1",
  handle: "@Alice_Builds",
  name: "Alice",
  avatar: "https://pbs.example/alice.png",
  walletAddress: "AliceWallet1111111111111111111111111111111",
  hasX: true,
};

test("creates a user and a readable session", async () => {
  const { token, session } = await repo.createSession(xIdentity);
  assert.equal(session.user.handle, "@Alice_Builds");
  assert.equal(session.user.hasX, true);
  const read = await repo.readSession(token);
  assert.equal(read?.user.id, session.user.id);
  assert.equal(read?.csrfToken, session.csrfToken);
});

test("signing in again updates the same user and keeps prior fields", async () => {
  const first = await repo.createSession(xIdentity);
  const second = await repo.createSession({ ...xIdentity, avatar: undefined, walletAddress: undefined });
  assert.equal(second.session.user.id, first.session.user.id);
  assert.equal(second.session.user.avatar, xIdentity.avatar);
  assert.equal(second.session.user.walletAddress, xIdentity.walletAddress);
});

test("a different X account cannot take over an existing user", async () => {
  await assert.rejects(repo.createSession({ ...xIdentity, xUserId: "x-other" }), /does not match/);
});

test("users without X get a user- handle", async () => {
  const { session } = await repo.createSession({ did: "did:privy:abcd1234efgh", handle: "user-1234efgh", hasX: false });
  assert.equal(session.user.handle, "user-1234efgh");
  assert.equal(session.user.hasX, false);
});

test("destroyed and unknown sessions are rejected", async () => {
  const { token } = await repo.createSession(xIdentity);
  await repo.destroySession(token);
  assert.equal(await repo.readSession(token), undefined);
  assert.equal(await repo.readSession("not-a-token"), undefined);
});

test("profiles resolve by handle case-insensitively and hide the payout wallet", async () => {
  const { session } = await repo.createSession(xIdentity);
  const updated = await repo.updateProfile(session.user.id, { bio: "  building in public  " });
  assert.equal(updated.bio, "building in public");
  const viaHandle = await repo.getProfileByHandle("@alice_builds");
  assert.equal(viaHandle?.id, session.user.id);
  assert.equal(viaHandle?.payoutWallet, undefined);
});

test("onboarding needs a verified email, is validated and sets the user's intent", async () => {
  const { session } = await repo.createSession(xIdentity);
  const sponsor = { accountType: "sponsor", sponsor: { brandName: "Acme", category: "crypto" } };
  await assert.rejects(repo.saveOnboarding(session.user.id, sponsor), /verify your email/);
  const verified = await repo.createSession({ ...xIdentity, email: "alice@example.com" });
  assert.equal(verified.session.user.emailVerified, true);
  const terms = { accepted: "v1", current: "v1" };
  await assert.rejects(repo.saveOnboarding(session.user.id, { accountType: "creator", creator: { socials: {} } }, terms));
  const saved = await repo.saveOnboarding(session.user.id, sponsor, terms);
  assert.equal(saved.accountType, "sponsor");
  assert.deepEqual(await repo.getOnboarding(session.user.id), saved);
  // Later edits (settings) don't ask for the terms again.
  const both = await repo.saveOnboarding(session.user.id, { ...sponsor, accountType: "both", creator: { socials: { x: "@alice" } } });
  assert.equal(both.accountType, "both");
  assert.equal(both.creator?.socials.x, "@alice");
});

test("profile edits survive sign-in and handles are validated and unique", async () => {
  const { session } = await repo.createSession({ did: "did:privy:handles01", handle: "user-handles01", hasX: false });
  await repo.updateProfile(session.user.id, { displayName: "Bo", handle: "bo_rides" });
  const again = await repo.createSession({ did: "did:privy:handles01", handle: "user-handles01", name: "Ignored", hasX: false });
  assert.equal(again.session.user.handle, "bo_rides");
  assert.equal(again.session.user.name, "Bo");
  assert.equal(await repo.isHandleAvailable("BO_RIDES"), false);
  assert.equal(await repo.isHandleAvailable("bo_rides", session.user.id), true);
  const other = await repo.createSession({ did: "did:privy:handles02", handle: "user-handles02", hasX: false });
  await assert.rejects(repo.updateProfile(other.session.user.id, { handle: "Bo_Rides" }), /taken/);
  await assert.rejects(repo.updateProfile(other.session.user.id, { handle: "dashboard" }), /reserved/);
  await assert.rejects(repo.updateProfile(other.session.user.id, { handle: "a b" }), /letters/);
  const x = await repo.createSession(xIdentity);
  await assert.rejects(repo.updateProfile(x.session.user.id, { handle: "renamed" }), /X username/);
});

test("finishing onboarding needs the current terms version and records it once", async () => {
  const { session } = await repo.createSession({ did: "did:privy:terms01", handle: "user-terms01", email: "terms01@example.com", hasX: false });
  const sponsor = { accountType: "sponsor", sponsor: { brandName: "Acme", category: "crypto" } };
  await assert.rejects(repo.saveOnboarding(session.user.id, sponsor), (error: Error & { status?: number }) => error.status === 400 && /agree to the terms/.test(error.message));
  await assert.rejects(repo.saveOnboarding(session.user.id, sponsor, { accepted: "v0", current: "v1" }), (error: Error & { status?: number }) => error.status === 409 && /terms have changed/.test(error.message));
  assert.equal(await repo.getOnboarding(session.user.id), null);

  await repo.saveOnboarding(session.user.id, sponsor, { accepted: "v1", current: "v1" });
  await repo.saveOnboarding(session.user.id, { ...sponsor, sponsor: { brandName: "Acme 2", category: "crypto" } }, { accepted: undefined, current: "v1" });
  const rows = await db.select().from(termsAcceptances).where(eq(termsAcceptances.userId, session.user.id));
  assert.deepEqual(rows.map((row) => [row.context, row.termsVersion, row.spotId]), [["onboarding", "v1", null]]);
});
