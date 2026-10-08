import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Keypair } from "@solana/web3.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { withdrawals } from "../src/db/schema.js";
import { listWithdrawals, withdrawUsdc, type WalletDeps } from "../src/services/wallet.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedUser, USDC } from "./helpers/seed.js";

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let failChain: boolean;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  failChain = false;
});

const deps = (): WalletDeps => ({
  db,
  mint: Keypair.generate().publicKey,
  feePayer: keypairSigner(Keypair.generate()),
  runTx: fakeRunTx(db, sent, () => (failChain ? new Error("rpc down") : undefined)),
  readTokenBalance: async () => 1_000n * USDC,
  accountExists: async () => false,
  dailyLimit: 100n * USDC,
});

const destination = () => Keypair.generate().publicKey.toBase58();

test("withdraws to a valid wallet, creating its token account", async () => {
  const { user, signer } = await seedUser(db);
  const result = await withdrawUsdc(deps(), user.id, signer, destination(), 25n * USDC);
  assert.equal(result.withdrawal.state, "confirmed");
  assert.equal(sent[0].instructions.length, 2);
  assert.equal((await listWithdrawals(db, user.id)).length, 1);
});

test("rejects bad destinations and amounts before signing", async () => {
  const { user, signer } = await seedUser(db);
  await assert.rejects(withdrawUsdc(deps(), user.id, signer, "not-an-address", USDC), /valid Solana address/);
  await assert.rejects(withdrawUsdc(deps(), user.id, signer, signer.publicKey.toBase58(), USDC), /your own/);
  await assert.rejects(withdrawUsdc(deps(), user.id, signer, destination(), 0n), /above zero/);
  assert.equal(sent.length, 0);
});

// PGlite serialises queries on one connection; real row-lock contention needs Postgres.
test("parallel requests cannot exceed the daily limit", async () => {
  const { user, signer } = await seedUser(db);
  const attempts = await Promise.allSettled(
    [60n, 60n].map((amount) => withdrawUsdc(deps(), user.id, signer, destination(), amount * USDC)),
  );
  assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), ["fulfilled", "rejected"]);
  assert.match(String((attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult).reason), /daily withdrawal limit/);
});

test("a failed transfer frees up the daily limit", async () => {
  const { user, signer } = await seedUser(db);
  failChain = true;
  await assert.rejects(withdrawUsdc(deps(), user.id, signer, destination(), 90n * USDC), /rpc down/);
  const [failed] = await db.select().from(withdrawals).where(eq(withdrawals.userId, user.id));
  assert.equal(failed.state, "failed");
  failChain = false;
  const retry = await withdrawUsdc(deps(), user.id, signer, destination(), 90n * USDC);
  assert.equal(retry.withdrawal.state, "confirmed");
});

test("cannot withdraw more than the wallet holds", async () => {
  const { user, signer } = await seedUser(db);
  await assert.rejects(
    withdrawUsdc({ ...deps(), readTokenBalance: async () => 5n * USDC }, user.id, signer, destination(), 10n * USDC),
    /not enough USDC/,
  );
});
