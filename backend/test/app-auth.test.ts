import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { AppAuthRepository } from "../src/repositories/app-auth.js";
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

test("onboarding is validated and sets the user's intent", async () => {
  const { session } = await repo.createSession(xIdentity);
  await assert.rejects(repo.saveOnboarding(session.user.id, { accountType: "creator", creator: { socials: {} } }));
  const saved = await repo.saveOnboarding(session.user.id, {
    accountType: "sponsor",
    sponsor: { brandName: "Acme", category: "crypto" },
  });
  assert.equal(saved.accountType, "sponsor");
  assert.deepEqual(await repo.getOnboarding(session.user.id), saved);
});
