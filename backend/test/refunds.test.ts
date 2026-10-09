import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { spots } from "../src/db/schema.js";
import { closeListing, closeSpot, refundSpot, type RefundDeps } from "../src/services/refunds.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;

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

const deps = (): RefundDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  feePayer: keypairSigner(Keypair.generate()),
  runTx: fakeRunTx(db, sent),
  readVaultBalance: async () => 100n * USDC,
  accountExists: async () => true,
});

test("the creator can refund a funded spot before delivery", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() + HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  const result = await refundSpot(deps(), spot.id, { id: seller.user.id, sellerSigner: seller.signer });
  assert.equal(result.spot.state, "refunded");
  assert.equal(result.settlement.buyerRefund, 100n * USDC);
  assert.equal(sent[0].signers?.length, 1);
});

test("the creator must refund with the listing wallet", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() + HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  await assert.rejects(
    refundSpot(deps(), spot.id, { id: seller.user.id, sellerSigner: keypairSigner(Keypair.generate()) }),
    /listing wallet/,
  );
});

test("sponsors get a refund only after a missed delivery deadline without proof", async () => {
  const pending = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + HOUR),
    funded: true,
  });
  await assert.rejects(refundSpot(deps(), pending.spot.id, { id: pending.buyer!.user.id }), /misses the delivery deadline/);

  const missed = await seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
  const result = await refundSpot(deps(), missed.spot.id, { id: missed.buyer!.user.id });
  assert.equal(result.spot.state, "refunded");
  assert.deepEqual(sent.at(-1)?.signers, []);

  const delivered = await seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
  await db.update(spots).set({ state: "delivered", proofSubmittedAt: new Date() }).where(eq(spots.id, delivered.spot.id));
  await assert.rejects(refundSpot(deps(), delivered.spot.id, { id: delivered.buyer!.user.id }), /can't be refunded/);
});

test("closing: unsold spots close, listings wait for every spot to finish", async () => {
  const { seller, listing, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
  });
  const stranger = await seedUser(db);
  await assert.rejects(closeSpot(deps(), stranger.user.id, stranger.signer, spot.id), /only the creator/);
  await assert.rejects(closeListing(deps(), seller.user.id, seller.signer, listing.id), /remaining spot/);
  const closedSpot = await closeSpot(deps(), seller.user.id, seller.signer, spot.id);
  assert.equal(closedSpot.spot.state, "cancelled");
  const closedListing = await closeListing(deps(), seller.user.id, seller.signer, listing.id);
  assert.equal(closedListing.listing.state, "closed");
  assert.equal(sent.at(-1)?.instructions[0].keys.length, 3);
});

test("funded spots cannot be closed", async () => {
  const { seller, spot } = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 48 * HOUR),
    funded: true,
  });
  await assert.rejects(closeSpot(deps(), seller.user.id, seller.signer, spot.id), /unsold/);
});
