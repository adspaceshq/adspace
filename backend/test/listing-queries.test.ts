import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { listingPhotos, listings, mediaAssets } from "../src/db/schema.js";
import { getPublishedListing, listPublished, parseBrowseFilters } from "../src/services/listing-queries.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

test("filters parse defensively", () => {
  assert.deepEqual(parseBrowseFilters({ surface: "boat", mode: "x", sort: "?", limit: "500", offset: "-3" }), {
    q: undefined,
    surface: undefined,
    mode: undefined,
    sort: "closing",
    includeClosed: false,
    limit: 48,
    offset: 0,
  });
});

test("browse returns open listings with seller, photos, and paging", async () => {
  const soon = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  const later = await seedListing(db, { deadline: new Date(Date.now() + 5 * HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), mode: "auction" });
  await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR) });
  await db.update(listings).set({ title: "Token2049 laptop lid", audience: { event: "Token2049" } }).where(eq(listings.id, later.listing.id));
  const [photo] = await db
    .insert(mediaAssets)
    .values({ ownerId: soon.seller.user.id, kind: "listing_photo", url: "https://res.cloudinary.com/x/image/upload/a.jpg", bytes: 1, width: 800, height: 600 })
    .returning();
  await db.insert(listingPhotos).values({ listingId: soon.listing.id, assetId: photo.id, position: 0 });

  const all = await listPublished(db, { limit: 1 });
  assert.equal(all.items.length, 1);
  assert.equal(all.items[0].id, soon.listing.id);
  assert.equal(all.hasMore, true);
  assert.equal(all.items[0].photos[0].url, photo.url);
  assert.equal(all.items[0].seller.handle, soon.seller.user.handle);
  assert.equal("buyerId" in all.items[0].spots[0], false);

  const search = await listPublished(db, { q: "token2049" });
  assert.deepEqual(search.items.map((item) => item.id), [later.listing.id]);
  const auctions = await listPublished(db, { mode: "auction" });
  assert.ok(auctions.items.every((item) => item.mode === "auction"));
});

test("listing detail hides buyer identities", async () => {
  const { listing } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  const detail = await getPublishedListing(db, listing.slug);
  assert.equal(detail?.spots[0].taken, true);
  const serialized = JSON.stringify(detail, (_key, value) => (typeof value === "bigint" ? value.toString() : value));
  assert.equal(serialized.includes("buyerWallet"), false);
});
