import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { prepareChainTx, submitPreparedChainTx } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { chainTxs } from "../src/db/schema.js";
import { createTestDb } from "./helpers/db.js";

let db: Db;
let close: () => Promise<void>;
before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

// Just enough of a Connection for prepare/submit: a fixed blockhash, a block height, and a send log.
function fakeConnection(state: { height: number; sent: Buffer[] }) {
  return {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
    getBlockHeight: async () => state.height,
    sendRawTransaction: async (raw: Buffer) => {
      state.sent.push(raw);
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  } as unknown as Connection;
}

const feePayer = Keypair.generate();
const user = Keypair.generate();
const transfer = () => SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });

async function prepare(connection: Connection, key: string) {
  return prepareChainTx(db, connection, { op: "wallet_withdrawal", idempotencyKey: key, instructions: [transfer()], feePayer: keypairSigner(feePayer) });
}

const userSigns = (base64: string) => {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(user);
  return tx.serialize().toString("base64");
};

test("a prepared transaction is accepted only when the user signs exactly that transaction", async () => {
  const state = { height: 10, sent: [] as Buffer[] };
  const connection = fakeConnection(state);
  const prepared = await prepare(connection, "w:ok");

  // Unsigned by the user: rejected, nothing sent, still retryable.
  await assert.rejects(submitPreparedChainTx(db, connection, prepared.chainTxId, prepared.transaction), /missing a valid signature/);
  // Tampered: a different transfer signed by the user can't reuse the fee payer's signature.
  const swapped = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  swapped.instructions = [transfer()];
  swapped.partialSign(user);
  await assert.rejects(
    submitPreparedChainTx(db, connection, prepared.chainTxId, swapped.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64")),
    /does not match/,
  );
  await assert.rejects(submitPreparedChainTx(db, connection, prepared.chainTxId, "not base64 at all"), /could not be read/);
  assert.equal(state.sent.length, 0);

  const result = await submitPreparedChainTx(db, connection, prepared.chainTxId, userSigns(prepared.transaction));
  assert.equal(state.sent.length, 1);
  const [row] = await db.select().from(chainTxs).where(eq(chainTxs.id, prepared.chainTxId));
  assert.equal(row.status, "confirmed");
  assert.equal(row.signature, result.signature);
  // Submitting again returns the recorded result instead of resending.
  await submitPreparedChainTx(db, connection, prepared.chainTxId, userSigns(prepared.transaction));
  assert.equal(state.sent.length, 1);
});

test("an expired prepared transaction is refused and marked failed", async () => {
  const state = { height: 5000, sent: [] as Buffer[] };
  const connection = fakeConnection(state);
  const prepared = await prepare(connection, "w:expired");
  await assert.rejects(submitPreparedChainTx(db, connection, prepared.chainTxId, userSigns(prepared.transaction)), /expired/);
  const [row] = await db.select().from(chainTxs).where(eq(chainTxs.id, prepared.chainTxId));
  assert.equal(row.status, "failed");
  assert.equal(state.sent.length, 0);
});
