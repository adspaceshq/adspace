import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { settlements, spotEvents, spots } from "../src/db/schema.js";
import { payoutSeller, type SettlementDeps } from "../src/services/settlement.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let vaultBalance: bigint;
let existingAccounts: boolean;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  vaultBalance = 100n * USDC;
  existingAccounts = true;
});

const treasury = Keypair.generate().publicKey;
const rentPayer = Keypair.generate().publicKey;
const deps = (now = new Date()): SettlementDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  caller: keypairSigner(Keypair.generate()),
  rentPayer,
  runTx: fakeRunTx(db, sent),
  readListingSnapshot: async () => ({ treasury, fees: { mode: "fixed", feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 } }),
  readVaultBalance: async () => vaultBalance,
  accountExists: async () => existingAccounts,
  now: () => now,
});

async function deliveredSpot(deliveryDueAt: Date) {
  const seeded = await seedListing(db, { deadline: new Date(deliveryDueAt.getTime() - 48 * HOUR), deliveryDueAt, funded: true });
  await db
    .update(spots)
    .set({ state: "delivered", proofSubmittedAt: new Date(), proofHash: "ab" })
    .where(eq(spots.id, seeded.spot.id));
  return seeded;
}

test("pays the seller after the review window and records the settlement", async () => {
  const { spot } = await deliveredSpot(new Date(Date.now() - 72 * HOUR));
  const result = await payoutSeller(deps(), spot.id);
  assert.equal(result.spot.state, "settled");
  assert.equal(result.settlement.gross, 100n * USDC);
  assert.equal(result.settlement.fee, 5n * USDC);
  assert.equal(result.settlement.sellerNet, 95n * USDC);
  assert.equal(sent[0].idempotencyKey, `payout:${spot.id}`);
  // Spot, vault and proof rent go back to the platform's rent payer.
  const rentKey = sent[0].instructions.at(-1)!.keys.find((key) => key.pubkey.equals(rentPayer));
  assert.ok(rentKey?.isWritable);
  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.deepEqual(events.map((event) => event.type), ["seller_paid"]);
});

test("refuses payout while the buyer can still review", async () => {
  const { spot } = await deliveredSpot(new Date(Date.now() - HOUR));
  await assert.rejects(payoutSeller(deps(), spot.id), /payout opens/);
  assert.equal(sent.length, 0);
});

test("refuses payout without delivery proof", async () => {
  const { spot } = await seedListing(db, {
    deadline: new Date(Date.now() - 200 * HOUR),
    deliveryDueAt: new Date(Date.now() - 100 * HOUR),
    funded: true,
  });
  await assert.rejects(payoutSeller(deps(), spot.id), /only delivered/);
});

test("creates missing token accounts in the same transaction", async () => {
  const { spot } = await deliveredSpot(new Date(Date.now() - 72 * HOUR));
  existingAccounts = false;
  await payoutSeller(deps(), spot.id);
  assert.equal(sent[0].instructions.length, 3);
});

test("a retry after a confirmed payout does not pay twice", async () => {
  const { spot } = await deliveredSpot(new Date(Date.now() - 72 * HOUR));
  await payoutSeller(deps(), spot.id);
  await assert.rejects(payoutSeller(deps(), spot.id), /only delivered/);
  const rows = await db.select().from(settlements).where(eq(settlements.spotId, spot.id));
  assert.equal(rows.length, 1);
  assert.equal(sent.length, 1);
});
