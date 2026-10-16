import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { listings, mediaAssets, spotEvents, spots } from "../src/db/schema.js";
import { classifyLink, createPost, deletePost, listPosts, recordMetrics } from "../src/services/listing-posts.js";
import { listMessages, postMessage } from "../src/services/spot-messages.js";
import { proofHash, submitSpotProof, type ProofDeps } from "../src/services/spot-proof.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, seedUser } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
const PAST_DEADLINE = new Date(Date.now() - HOUR);
const DELIVERY = new Date(Date.now() + 24 * HOUR);

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
});

const platformKey = keypairSigner(Keypair.generate());
const proofDeps = (): ProofDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  feePayer: platformKey,
  rentPayer: platformKey,
  runTx: fakeRunTx(db, sent),
  listingBaseUrl: "https://adspaces.fun",
});

test("classifies social links and rejects unsafe ones", () => {
  assert.deepEqual(classifyLink("https://x.com/alice/status/1844"), { kind: "x", url: "https://x.com/alice/status/1844", externalId: "1844" });
  assert.equal(classifyLink("https://twitter.com/alice/status/99").kind, "x");
  assert.equal(classifyLink("https://www.instagram.com/reel/Cx12_ab/").externalId, "Cx12_ab");
  assert.equal(classifyLink("https://www.tiktok.com/@a/video/7381").externalId, "7381");
  assert.equal(classifyLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ").externalId, "dQw4w9WgXcQ");
  assert.equal(classifyLink("https://youtu.be/dQw4w9WgXcQ").kind, "youtube");
  assert.equal(classifyLink("https://adspaces.fun/blog").kind, "link");
  assert.throws(() => classifyLink("http://x.com/a/status/1"), /https/);
  assert.throws(() => classifyLink("javascript:alert(1)"));
});

test("only the creator or a reviewer can post, and only on live listings", async () => {
  const { seller, listing } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY });
  const stranger = await seedUser(db);
  await assert.rejects(createPost(db, { id: stranger.user.id, isReviewer: false }, listing.id, { body: "hi" }), /only the creator/);
  const reviewerPost = await createPost(db, { id: stranger.user.id, isReviewer: true }, listing.id, { body: "verified on site" });
  assert.equal(reviewerPost.kind, "text");
  const post = await createPost(db, { id: seller.user.id, isReviewer: false }, listing.id, { url: "https://x.com/s/status/1", body: "live!" });
  assert.equal(post.kind, "x");
  await db.update(listings).set({ state: "approved" }).where(eq(listings.id, listing.id));
  await assert.rejects(createPost(db, { id: seller.user.id, isReviewer: false }, listing.id, { body: "x" }), /once the listing is live/);
});

test("photos must belong to the poster", async () => {
  const { seller, listing } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY });
  const other = await seedUser(db);
  const [foreign] = await db
    .insert(mediaAssets)
    .values({ ownerId: other.user.id, kind: "post_media", url: "https://res.cloudinary.com/x/image/upload/a.jpg", bytes: 10 })
    .returning();
  await assert.rejects(
    createPost(db, { id: seller.user.id, isReviewer: false }, listing.id, { mediaAssetIds: [foreign.id] }),
    /isn't yours/,
  );
  const [own] = await db
    .insert(mediaAssets)
    .values({ ownerId: seller.user.id, kind: "post_media", url: "https://res.cloudinary.com/x/image/upload/b.jpg", bytes: 10 })
    .returning();
  const post = await createPost(db, { id: seller.user.id, isReviewer: false }, listing.id, { mediaAssetIds: [own.id] });
  assert.equal(post.kind, "photo");
  const [feedPost] = await listPosts(db, listing.id);
  assert.equal(feedPost.media[0].url, own.url);
});

test("feed shows latest metrics; proof posts can't be deleted", async () => {
  const { seller, listing, spot } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY, funded: true });
  const creator = { id: seller.user.id, isReviewer: false };
  const post = await createPost(db, creator, listing.id, { url: "https://x.com/s/status/42" });
  await recordMetrics(db, post.id, "manual", { views: 100, likes: 5 });
  await recordMetrics(db, post.id, "manual", { views: 250, likes: 9 });
  await assert.rejects(recordMetrics(db, post.id, "manual", { views: -1 }));
  const [feedPost] = await listPosts(db, listing.id);
  assert.equal(feedPost.metrics?.views, 250);

  await submitSpotProof(proofDeps(), seller.user.id, seller.signer, spot.id, [post.id]);
  await assert.rejects(deletePost(db, creator, post.id), /delivery proof/);
});

test("proof tags posts, moves the spot to delivered, and records the hash", async () => {
  const { seller, listing, spot } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY, funded: true });
  const creator = { id: seller.user.id, isReviewer: false };
  const first = await createPost(db, creator, listing.id, { url: "https://x.com/s/status/7" });
  const second = await createPost(db, creator, listing.id, { body: "spot is on the lid now" });

  const result = await submitSpotProof(proofDeps(), seller.user.id, seller.signer, spot.id, [second.id, first.id]);
  assert.equal(result.spot.state, "delivered");
  const expected = proofHash(spot.id, [
    { id: first.id, url: first.url, body: first.body },
    { id: second.id, url: second.url, body: second.body },
  ]).toString("hex");
  assert.equal(result.spot.proofHash, expected);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].idempotencyKey, `proof:${spot.id}`);
  // The platform pays the proof rent; it is the fee payer here, so only the creator co-signs.
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [seller.signer.publicKey.toBase58()]);
  assert.ok(sent[0].instructions[0].keys[1].pubkey.equals(platformKey.publicKey));
  assert.ok(sent[0].instructions[0].keys[1].isSigner);
  const feed = await listPosts(db, listing.id);
  assert.ok(feed.every((post) => post.proofForSpotIds.includes(spot.id)));
  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.deepEqual(events.map((event) => event.type), ["proof_submitted"]);
});

test("proof respects the delivery window and ownership", async () => {
  const early = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: DELIVERY, funded: true });
  const earlyPost = await createPost(db, { id: early.seller.user.id, isReviewer: false }, early.listing.id, { body: "x" });
  await assert.rejects(
    submitSpotProof(proofDeps(), early.seller.user.id, early.seller.signer, early.spot.id, [earlyPost.id]),
    /proof opens at/,
  );
  // The listing closed but the artwork window hasn't: the program only accepts proof from artwork close.
  const artworkOpen = await seedListing(db, { deadline: PAST_DEADLINE, artworkDueAt: new Date(Date.now() + 2 * HOUR), deliveryDueAt: DELIVERY, funded: true });
  const artworkPost = await createPost(db, { id: artworkOpen.seller.user.id, isReviewer: false }, artworkOpen.listing.id, { body: "x" });
  await assert.rejects(
    submitSpotProof(proofDeps(), artworkOpen.seller.user.id, artworkOpen.seller.signer, artworkOpen.spot.id, [artworkPost.id]),
    /proof opens at .* utc, when the artwork window closes/,
  );

  const { seller, buyer, listing, spot } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY, funded: true });
  const post = await createPost(db, { id: seller.user.id, isReviewer: false }, listing.id, { body: "done" });
  await assert.rejects(submitSpotProof(proofDeps(), buyer!.user.id, buyer!.signer, spot.id, [post.id]), /only the creator/);
  await assert.rejects(submitSpotProof(proofDeps(), seller.user.id, seller.signer, spot.id, [early.listing.id]), /live posts/);
  const [unchanged] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(unchanged.state, "funded");
  assert.equal(sent.length, 0);
});

test("spot messages are private to sponsor, creator and reviewers", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: PAST_DEADLINE, deliveryDueAt: DELIVERY, funded: true });
  const stranger = await seedUser(db);
  await postMessage(db, { id: buyer!.user.id, isReviewer: false }, spot.id, "logo is attached, use the dark version");
  await postMessage(db, { id: seller.user.id, isReviewer: false }, spot.id, "got it");
  await assert.rejects(postMessage(db, { id: stranger.user.id, isReviewer: false }, spot.id, "hey"), /private/);
  const asReviewer = await listMessages(db, { id: stranger.user.id, isReviewer: true }, spot.id);
  assert.deepEqual(asReviewer.map((message) => message.body), ["logo is attached, use the dark version", "got it"]);
  await assert.rejects(postMessage(db, { id: seller.user.id, isReviewer: false }, spot.id, "   "));
});
