import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Keypair } from "@solana/web3.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { chainTxs, withdrawals } from "../src/db/schema.js";
import { expireUnsignedWithdrawals, listWithdrawals, prepareWithdrawal, submitWithdrawal, type WalletDeps } from "../src/services/wallet.js";
import { createTestDb } from "./helpers/db.js";
import { seedUser, USDC } from "./helpers/seed.js";

let db: Db;
let close: () => Promise<void>;
let prepared: Array<Omit<ChainTxRequest, "signers">>;
let submitError: (Error & { status?: number }) | undefined;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  prepared = [];
  submitError = undefined;
});

// Prepare records a pending chain tx like the runner; submit confirms it unless told to fail.
const deps = (): WalletDeps => ({
  db,
  mint: Keypair.generate().publicKey,
  feePayer: keypairSigner(Keypair.generate()),
  prepareTx: async (request) => {
    prepared.push(request);
    const [row] = await db.insert(chainTxs).values({ op: request.op, idempotencyKey: request.idempotencyKey, actorId: request.actorId, preparedTx: "tx" }).returning();
    return { chainTxId: row.id, transaction: `prepared:${row.id}` };
  },
  submitTx: async (chainTxId) => {
    if (submitError) throw submitError;
    const signature = `sig-${randomUUID()}`;
    await db.update(chainTxs).set({ status: "confirmed", signature, confirmedAt: new Date() }).where(eq(chainTxs.id, chainTxId));
    return { chainTxId, signature };
  },
  readTokenBalance: async () => 1_000n * USDC,
  accountExists: async () => false,
  dailyLimit: 100n * USDC,
});

const destination = () => Keypair.generate().publicKey.toBase58();

test("prepares a transfer that creates the destination account, then confirms what the user signed", async () => {
  const { user, signer } = await seedUser(db);
  const step = await prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 25n * USDC);
  assert.equal(prepared[0].instructions.length, 2);
  assert.equal(prepared[0].signers, undefined);
  const [pending] = await listWithdrawals(db, user.id);
  assert.equal(pending.state, "pending");

  const done = await submitWithdrawal(deps(), user.id, step.withdrawalId, "signed");
  assert.equal(done.withdrawal.state, "confirmed");
  const [listed] = await listWithdrawals(db, user.id);
  assert.equal(listed.signature, done.signature);
  await assert.rejects(submitWithdrawal(deps(), user.id, step.withdrawalId, "signed"), /no longer waiting/);
});

test("only the owner can submit a withdrawal", async () => {
  const owner = await seedUser(db);
  const other = await seedUser(db);
  const step = await prepareWithdrawal(deps(), owner.user.id, owner.signer.publicKey, destination(), USDC);
  await assert.rejects(submitWithdrawal(deps(), other.user.id, step.withdrawalId, "signed"), /not found/);
});

test("rejects bad destinations and amounts before preparing", async () => {
  const { user, signer } = await seedUser(db);
  await assert.rejects(prepareWithdrawal(deps(), user.id, signer.publicKey, "not-an-address", USDC), /valid Solana address/);
  await assert.rejects(prepareWithdrawal(deps(), user.id, signer.publicKey, signer.publicKey.toBase58(), USDC), /your own/);
  await assert.rejects(prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 0n), /above zero/);
  await assert.rejects(prepareWithdrawal({ ...deps(), readTokenBalance: async () => 5n * USDC }, user.id, signer.publicKey, destination(), 10n * USDC), /not enough USDC/);
  assert.equal(prepared.length, 0);
});

// PGlite serialises queries on one connection; real row-lock contention needs Postgres.
test("parallel requests cannot exceed the daily limit", async () => {
  const { user, signer } = await seedUser(db);
  const attempts = await Promise.allSettled([60n, 60n].map((amount) => prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), amount * USDC)));
  assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), ["fulfilled", "rejected"]);
  assert.match(String((attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult).reason), /daily withdrawal limit/);
});

test("withdrawals follow their transaction: unsent can retry, unconfirmed holds the limit, failed frees it", async () => {
  const { user, signer } = await seedUser(db);
  const step = await prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 90n * USDC);
  const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, step.withdrawalId));
  const txStatus = (status: "submitted" | "failed") => db.update(chainTxs).set({ status }).where(eq(chainTxs.id, row.chainTxId!));
  const state = async () => (await listWithdrawals(db, user.id))[0].state;

  submitError = Object.assign(new Error("the signed transaction does not match what was prepared"), { status: 400 });
  await assert.rejects(submitWithdrawal(deps(), user.id, step.withdrawalId, "tampered"), /does not match/);
  assert.equal(await state(), "pending");

  // RPC down before sending: nothing went out, so the user can retry.
  submitError = Object.assign(new Error("rpc down"), { status: 502 });
  await assert.rejects(submitWithdrawal(deps(), user.id, step.withdrawalId, "signed"), /rpc down/);
  assert.equal(await state(), "pending");

  // Sent but the confirmation timed out: it may still land, so it keeps counting toward the limit.
  await txStatus("submitted");
  await assert.rejects(submitWithdrawal(deps(), user.id, step.withdrawalId, "signed"), /rpc down/);
  assert.equal(await state(), "submitted");
  await assert.rejects(prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 90n * USDC));

  // Failed on chain: the limit is released.
  await db.update(withdrawals).set({ state: "pending" }).where(eq(withdrawals.id, step.withdrawalId));
  await txStatus("failed");
  await assert.rejects(submitWithdrawal(deps(), user.id, step.withdrawalId, "signed"));
  assert.equal(await state(), "failed");

  submitError = undefined;
  const retry = await prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 90n * USDC);
  assert.equal((await submitWithdrawal(deps(), user.id, retry.withdrawalId, "signed")).withdrawal.state, "confirmed");
});

test("withdrawals never signed expire and release the daily limit", async () => {
  const { user, signer } = await seedUser(db);
  const step = await prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 90n * USDC);
  assert.equal(await expireUnsignedWithdrawals(db), 0);
  // Other tests leave unsigned withdrawals too; this one must be among those expired.
  assert.ok((await expireUnsignedWithdrawals(db, new Date(Date.now() + 10 * 60 * 1000))) >= 1);
  const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, step.withdrawalId));
  assert.equal(row.state, "failed");
  await prepareWithdrawal(deps(), user.id, signer.publicKey, destination(), 90n * USDC);
});

test("withdrawal history pages back by creation time", async () => {
  const { user } = await seedUser(db);
  const base = Date.now() - 10 * 60_000;
  for (let i = 0; i < 3; i += 1) {
    await db.insert(withdrawals).values({ userId: user.id, amount: BigInt(i + 1) * USDC, destination: "dest", state: "confirmed", createdAt: new Date(base + i * 60_000) });
  }
  const first = await listWithdrawals(db, user.id, 2);
  assert.deepEqual(first.map((item) => item.amount), [3n * USDC, 2n * USDC]);
  const next = await listWithdrawals(db, user.id, 2, first[1].createdAt);
  assert.deepEqual(next.map((item) => item.amount), [1n * USDC]);
});
