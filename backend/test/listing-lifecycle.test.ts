import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { chainTxs, listings, mediaAssets, spots, users } from "../src/db/schema.js";
import {
  acceptTermsAndPublish,
  createDraft,
  ListingError,
  reviewListing,
  submitForReview,
  updateDraft,
  validateFeePolicy,
  type DraftInput,
  type PublishDeps,
} from "../src/services/listing-lifecycle.js";
import { createTestDb } from "./helpers/db.js";

const USDC = 1_000_000n;
const NOW = new Date("2026-10-08T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const FLOOR = 250;

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let failOnKey: string | null;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  failOnKey = null;
});

// Honours idempotency like the real runner: a confirmed key is returned, not re-sent.
const publishDeps = (): PublishDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  reviewer: keypairSigner(Keypair.generate()),
  ensureSellerFunding: async () => {},
  metadataBaseUrl: "https://adspaces.fun",
  termsVersion: "2026-10-01",
  now: () => NOW,
  runTx: async (request) => {
    const [existing] = await db.select().from(chainTxs).where(eq(chainTxs.idempotencyKey, request.idempotencyKey));
    if (existing?.status === "confirmed") return { chainTxId: existing.id, signature: existing.signature! };
    if (request.idempotencyKey === failOnKey) throw new Error("rpc timeout");
    sent.push(request);
    const [row] = await db
      .insert(chainTxs)
      .values({
        op: request.op,
        idempotencyKey: request.idempotencyKey,
        status: "confirmed",
        signature: `sig-${randomUUID()}`,
        confirmedAt: NOW,
      })
      .returning();
    return { chainTxId: row.id, signature: row.signature! };
  },
});

async function createUser() {
  const handle = `u_${randomUUID().slice(0, 8)}`;
  const [user] = await db.insert(users).values({ privyDid: `did:${handle}`, handle, displayName: handle }).returning();
  return user;
}

const draftInput = (overrides: Partial<DraftInput> = {}): DraftInput => ({
  surface: "laptop",
  title: "MacBook lid at Token2049",
  mode: "fixed",
  deadline: new Date(NOW.getTime() + 3 * DAY),
  spots: [
    { price: 50n * USDC, layout: { x: 10, y: 10, w: 20 } },
    { price: 75n * USDC, layout: { x: 40, y: 10, w: 20 } },
  ],
  ...overrides,
});

async function photoFor(ownerId: string) {
  const [asset] = await db
    .insert(mediaAssets)
    .values({ ownerId, kind: "listing_photo", url: `https://res.cloudinary.com/demo/image/upload/adspaces/listings/${randomUUID()}.jpg`, bytes: 1000 })
    .returning();
  return asset.id;
}

const approve = { action: "approve" as const, fees: { feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 } };

test("drafts validate schedule, spots and auction rules", async () => {
  const seller = await createUser();
  await assert.rejects(createDraft(db, seller.id, draftInput({ deadline: new Date(NOW.getTime() - DAY) }), NOW), /future/);
  await assert.rejects(createDraft(db, seller.id, draftInput({ spots: [] }), NOW), /spots/);
  await assert.rejects(createDraft(db, seller.id, draftInput({ mode: "auction" }), NOW), /increment/);
  const { listing, spots: created } = await createDraft(db, seller.id, draftInput(), NOW);
  assert.equal(listing.state, "draft");
  assert.match(listing.slug, /^macbook-lid-at-token2049-[0-9a-f]{8}$/);
  assert.equal(created.length, 2);
  assert.equal(listing.deliveryDueAt.getTime(), listing.artworkDueAt.getTime() + 7 * DAY);
});

test("fee policy mirrors the program rules", () => {
  assert.throws(() => validateFeePolicy("fixed", { feeBps: 200, upliftFeeBps: 0, maxFeeBps: 200 }, FLOOR), /floor/);
  assert.throws(() => validateFeePolicy("fixed", { feeBps: 500, upliftFeeBps: 100, maxFeeBps: 500 }, FLOOR), /flat/);
  assert.throws(() => validateFeePolicy("auction", { feeBps: 250, upliftFeeBps: 900, maxFeeBps: 1000 }, FLOOR), /cap/);
  validateFeePolicy("auction", { feeBps: 250, upliftFeeBps: 2000, maxFeeBps: 1000 }, FLOOR);
});

test("review: no self-review, requires a note for changes, approval stores fees", async () => {
  const seller = await createUser();
  const reviewer = await createUser();
  const { listing } = await createDraft(db, seller.id, draftInput({ photoAssetIds: [await photoFor(seller.id)] }), NOW);
  await assert.rejects(reviewListing(db, reviewer.id, listing.id, approve, FLOOR, NOW), /not waiting/);
  await submitForReview(db, seller.id, listing.id);
  await assert.rejects(reviewListing(db, seller.id, listing.id, approve, FLOOR, NOW), /own listing/);
  await assert.rejects(reviewListing(db, reviewer.id, listing.id, { action: "request_changes", note: " " }, FLOOR, NOW));
  const changes = await reviewListing(db, reviewer.id, listing.id, { action: "request_changes", note: "add photos" }, FLOOR, NOW);
  assert.equal(changes.state, "changes_requested");
  await submitForReview(db, seller.id, listing.id);
  const approved = await reviewListing(db, reviewer.id, listing.id, approve, FLOOR, NOW);
  assert.equal(approved.state, "approved");
  assert.equal(approved.feeBps, 500);
  assert.equal(approved.reviewedBy, reviewer.id);
});

test("only the seller can submit their draft", async () => {
  const seller = await createUser();
  const stranger = await createUser();
  const { listing } = await createDraft(db, seller.id, draftInput(), NOW);
  await assert.rejects(submitForReview(db, stranger.id, listing.id), ListingError);
});

async function approvedListing() {
  const seller = await createUser();
  const reviewer = await createUser();
  const { listing } = await createDraft(db, seller.id, draftInput({ photoAssetIds: [await photoFor(seller.id)] }), NOW);
  await submitForReview(db, seller.id, listing.id);
  await reviewListing(db, reviewer.id, listing.id, approve, FLOOR, NOW);
  return { seller, listing, sellerSigner: keypairSigner(Keypair.generate()) };
}

test("publishing creates the listing and every spot on-chain", async () => {
  const { seller, listing, sellerSigner } = await approvedListing();
  const published = await acceptTermsAndPublish(publishDeps(), seller.id, listing.id, sellerSigner);
  assert.equal(published.state, "published");
  assert.ok(published.chainAddress);
  assert.ok(published.termsAcceptedAt);
  assert.deepEqual(
    sent.map((tx) => tx.idempotencyKey.split(":")[0]),
    ["publish", "add_spot", "add_spot"],
  );
  const stored = await db.select().from(spots).where(eq(spots.listingId, listing.id));
  assert.ok(stored.every((spot) => spot.chainAddress && spot.vaultAddress));
});

test("a publish that fails midway resumes without re-sending finished steps", async () => {
  const { seller, listing, sellerSigner } = await approvedListing();
  const [, secondSpot] = await db.select().from(spots).where(eq(spots.listingId, listing.id)).orderBy(spots.index);
  failOnKey = `add_spot:${secondSpot.id}`;
  await assert.rejects(acceptTermsAndPublish(publishDeps(), seller.id, listing.id, sellerSigner), /rpc timeout/);
  const [midway] = await db.select().from(listings).where(eq(listings.id, listing.id));
  assert.equal(midway.state, "publishing");

  sent = [];
  failOnKey = null;
  const published = await acceptTermsAndPublish(publishDeps(), seller.id, listing.id, sellerSigner);
  assert.equal(published.state, "published");
  assert.deepEqual(sent.map((tx) => tx.idempotencyKey), [`add_spot:${secondSpot.id}`]);
});

test("a retry must use the same seller wallet", async () => {
  const { seller, listing, sellerSigner } = await approvedListing();
  failOnKey = `publish:${listing.id}`;
  await assert.rejects(acceptTermsAndPublish(publishDeps(), seller.id, listing.id, sellerSigner));
  await assert.rejects(
    acceptTermsAndPublish(publishDeps(), seller.id, listing.id, keypairSigner(Keypair.generate())),
    /same wallet|wallet you started/,
  );
});

test("unapproved listings cannot be published", async () => {
  const seller = await createUser();
  const { listing } = await createDraft(db, seller.id, draftInput(), NOW);
  await assert.rejects(acceptTermsAndPublish(publishDeps(), seller.id, listing.id, keypairSigner(Keypair.generate())), /approved/);
  assert.equal(sent.length, 0);
});

test("spots can sit on any of the listing's photos; view must name one", async () => {
  const seller = await createUser();
  const photos = [await photoFor(seller.id), await photoFor(seller.id)];
  const layout = { x: 20, y: 20, w: 10 };
  const { spots: created } = await createDraft(
    db,
    seller.id,
    draftInput({
      photoAssetIds: photos,
      spots: [
        { price: USDC, layout },
        { price: USDC, layout: { ...layout, view: "0" } },
        { price: USDC, layout: { ...layout, view: "1" } },
      ],
    }),
    NOW,
  );
  assert.deepEqual(
    created.map((spot) => spot.layout.view),
    [undefined, undefined, "1"],
  );
  assert.equal("view" in created[1].layout, false);
  for (const view of ["2", "-1", "1.0", "01x", "", " 1", "lid"]) {
    await assert.rejects(
      createDraft(db, seller.id, draftInput({ photoAssetIds: photos, spots: [{ price: USDC, layout: { ...layout, view } }] }), NOW),
      (error: unknown) => error instanceof ListingError && error.status === 400 && /one of the listing's 2 photos/.test(error.message),
      `view ${JSON.stringify(view)} should be rejected`,
    );
  }
  await assert.rejects(
    createDraft(db, seller.id, draftInput({ photoAssetIds: [photos[0]], spots: [{ price: USDC, layout: { ...layout, view: "1" } }] }), NOW),
    /only sit on the cover/,
  );
  await assert.rejects(
    createDraft(db, seller.id, draftInput({ photoAssetIds: photos, spots: [{ price: USDC, layout: { ...layout, view: 1 as unknown as string } }] }), NOW),
    /one of the listing's 2 photos/,
  );
});

test("submitting needs a photo; photos must be the seller's own", async () => {
  const seller = await createUser();
  const other = await createUser();
  const { listing } = await createDraft(db, seller.id, draftInput(), NOW);
  await assert.rejects(submitForReview(db, seller.id, listing.id), /at least one photo/);
  await assert.rejects(createDraft(db, seller.id, draftInput({ photoAssetIds: [await photoFor(other.id)] }), NOW), /isn't yours/);
});

test("drafts can be edited until submitted, and again when changes are requested", async () => {
  const seller = await createUser();
  const reviewer = await createUser();
  const photo = await photoFor(seller.id);
  const { listing } = await createDraft(db, seller.id, draftInput({ photoAssetIds: [photo] }), NOW);
  const edited = await updateDraft(
    db,
    seller.id,
    listing.id,
    draftInput({ title: "Updated lid", photoAssetIds: [photo], spots: [{ price: 9n * USDC, layout: { x: 50, y: 50, w: 20 } }] }),
    NOW,
  );
  assert.equal(edited.listing.title, "Updated lid");
  assert.equal(edited.listing.slug, listing.slug);
  assert.equal(edited.spots.length, 1);
  await assert.rejects(updateDraft(db, seller.id, listing.id, draftInput({ spots: [{ price: USDC, layout: { x: 150, y: 0, w: 10 } }] }), NOW), /sit on the photo/);
  await submitForReview(db, seller.id, listing.id);
  await assert.rejects(updateDraft(db, seller.id, listing.id, draftInput(), NOW), /can be edited/);
  await reviewListing(db, reviewer.id, listing.id, { action: "request_changes", note: "show the whole lid" }, FLOOR, NOW);
  const fixed = await updateDraft(db, seller.id, listing.id, draftInput({ photoAssetIds: [photo] }), NOW);
  assert.equal(fixed.listing.state, "changes_requested");
});
