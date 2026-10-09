import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { spots } from "../src/db/schema.js";
import { getSponsoredSpot } from "../src/services/listing-queries.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("sold spots expose the sponsor's brand, never their account", async () => {
  const { listing, spot } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  await db.update(spots).set({ brand: { name: "Acme", handle: "acme" } }).where(eq(spots.id, spot.id));

  const sponsored = await getSponsoredSpot(db, listing.slug, 0);
  assert.deepEqual(sponsored?.brand, { name: "Acme", handle: "acme" });
  const body = JSON.stringify(sponsored, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  assert.equal(body.includes(spot.buyerId!), false);
  assert.equal(body.includes(spot.buyerWallet!), false);

  assert.equal(await getSponsoredSpot(db, listing.slug, 1), undefined);
  assert.equal(await getSponsoredSpot(db, listing.slug, -1), undefined);
  await db.update(spots).set({ state: "refunded" }).where(eq(spots.id, spot.id));
  assert.equal(await getSponsoredSpot(db, listing.slug, 0), undefined);
});
