import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Db } from "../src/db/client.js";
import { getPrefs } from "../src/services/notifications.js";
import { readUnsubscribeToken, resubscribe, unsubscribe, unsubscribeStatus, unsubscribeToken } from "../src/services/unsubscribe.js";
import { createTestDb } from "./helpers/db.js";
import { seedUser } from "./helpers/seed.js";

const SECRET = "test-unsubscribe-secret";
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("a token reads back to its user and category", () => {
  const userId = "7d8a4c1e-2b3f-4a5d-9e6f-0a1b2c3d4e5f";
  const token = unsubscribeToken(SECRET, userId, "bidding")!;
  assert.deepEqual(readUnsubscribeToken(SECRET, token), { userId, category: "bidding" });
});

test("tampered, foreign and service tokens are refused", () => {
  const userId = "7d8a4c1e-2b3f-4a5d-9e6f-0a1b2c3d4e5f";
  const token = unsubscribeToken(SECRET, userId, "bidding")!;
  assert.equal(readUnsubscribeToken(SECRET, token.replace("bidding", "payments")), null);
  assert.equal(readUnsubscribeToken("another-secret", token), null);
  assert.equal(readUnsubscribeToken(SECRET, `${token}x`), null);
  assert.equal(readUnsubscribeToken(SECRET, "not-a-token"), null);
  assert.equal(readUnsubscribeToken(SECRET, undefined), null);
  assert.equal(unsubscribeToken(SECRET, userId, "support"), null);
});

test("unsubscribing turns off only that category, and resubscribing turns it back on", async () => {
  const { user } = await seedUser(db, "unsub");
  const token = unsubscribeToken(SECRET, user.id, "bidding")!;
  assert.deepEqual(await unsubscribeStatus(db, SECRET, token), { category: "bidding", subscribed: true });

  assert.deepEqual(await unsubscribe(db, SECRET, token), { category: "bidding", subscribed: false });
  assert.deepEqual(await unsubscribe(db, SECRET, token), { category: "bidding", subscribed: false });
  const prefs = await getPrefs(db, user.id);
  assert.equal(prefs.bidding, false);
  assert.equal(prefs.payments, true);

  assert.deepEqual(await resubscribe(db, SECRET, token), { category: "bidding", subscribed: true });
  assert.equal((await getPrefs(db, user.id)).bidding, true);
  assert.equal(await unsubscribe(db, SECRET, "bad"), null);
});
