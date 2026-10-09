import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { spots, users } from "../src/db/schema.js";
import { publicProfilePage } from "../src/services/profiles.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("public profile shows track record, socials and listings without buyer details", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  await db.update(users).set({ onboarding: { accountType: "creator", creator: { socials: { x: "@seller" } } } }).where(eq(users.id, seller.user.id));

  const fresh = await publicProfilePage(db, seller.user.handle.toUpperCase());
  assert.equal(fresh?.stats.spotsSold, 1);
  assert.equal(fresh?.stats.onTimeRate, null);
  assert.equal(fresh?.stats.activeListings, 1);
  assert.deepEqual(fresh?.socials, { x: "@seller" });
  assert.equal(fresh?.listings.length, 1);
  assert.equal("buyerId" in fresh!.listings[0].spots[0], false);
  assert.equal("walletAddress" in fresh!, false);

  await db.update(spots).set({ state: "delivered", proofSubmittedAt: new Date() }).where(eq(spots.id, spot.id));
  const delivered = await publicProfilePage(db, `@${seller.user.handle}`);
  assert.equal(delivered?.stats.onTimeRate, 1);
  assert.equal(delivered?.stats.deliveries, 1);

  const sponsor = await publicProfilePage(db, buyer!.user.handle);
  assert.equal(sponsor?.stats.spotsSponsored, 1);
  assert.equal(sponsor?.listings.length, 0);
  assert.equal(await publicProfilePage(db, "nobody_here"), undefined);
});

test("overdue deliveries count against the on-time rate", async () => {
  const { seller } = await seedListing(db, { deadline: new Date(Date.now() - 48 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  const page = await publicProfilePage(db, seller.user.handle);
  assert.equal(page?.stats.onTimeRate, 0);
  assert.equal(page?.stats.activeListings, 0);
});
