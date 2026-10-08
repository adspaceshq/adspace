import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { listings } from "../src/db/schema.js";
import { listWatchlist, unwatchListing, watchListing } from "../src/services/watchlist.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("sponsors save, list and remove public listings", async () => {
  const { listing, seller } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const sponsor = await seedUser(db, "sponsor");

  await watchListing(db, sponsor.user.id, listing.id);
  await watchListing(db, sponsor.user.id, listing.id);
  const saved = await listWatchlist(db, sponsor.user.id);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].listing?.id, listing.id);

  await assert.rejects(watchListing(db, seller.user.id, listing.id), /your own/);
  await assert.rejects(watchListing(db, sponsor.user.id, "00000000-0000-0000-0000-000000000000"), /not found/);

  await db.update(listings).set({ state: "draft" }).where(eq(listings.id, listing.id));
  assert.equal((await listWatchlist(db, sponsor.user.id)).length, 0);

  await unwatchListing(db, sponsor.user.id, listing.id);
  await db.update(listings).set({ state: "published" }).where(eq(listings.id, listing.id));
  assert.equal((await listWatchlist(db, sponsor.user.id)).length, 0);
});
