import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import type { Db } from "../src/db/client.js";
import { setDisputeTimeout, setPaused, type AdminDeps, type ProtocolStatus } from "../src/services/admin.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedUser } from "./helpers/seed.js";

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let status: ProtocolStatus;

const authority = keypairSigner(Keypair.generate());

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  status = {
    authority: authority.publicKey,
    treasury: Keypair.generate().publicKey,
    feeBps: 250,
    paused: false,
    disputeTimeoutSeconds: 3 * 24 * 60 * 60,
  };
});

const deps = (signer = authority): AdminDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  authority: signer,
  runTx: async (request) => {
    const result = await fakeRunTx(db, sent)(request);
    if (request.op === "pause_protocol") status = { ...status, paused: !status.paused };
    return result;
  },
  readProtocolStatus: async () => status,
});

test("pausing sends one transaction and is a no-op when already in that state", async () => {
  const { user } = await seedUser(db, "admin");
  const paused = await setPaused(deps(), user.id, true);
  assert.equal(paused.status.paused, true);
  assert.equal(sent.length, 1);
  const again = await setPaused(deps(), user.id, true);
  assert.equal(again.signature, null);
  assert.equal(sent.length, 1);
});

test("dispute timeout is bounded and skips unchanged values", async () => {
  const { user } = await seedUser(db, "admin");
  await assert.rejects(setDisputeTimeout(deps(), user.id, 59 * 60), /between 1 hour and 30 days/);
  await assert.rejects(setDisputeTimeout(deps(), user.id, 31 * 24 * 60 * 60), /between/);
  const unchanged = await setDisputeTimeout(deps(), user.id, 3 * 24 * 60 * 60);
  assert.equal(unchanged.signature, null);
  await setDisputeTimeout(deps(), user.id, 2 * 24 * 60 * 60);
  assert.equal(sent.at(-1)?.op, "set_dispute_timeout");
});

test("refuses to sign when the server key is not the config authority", async () => {
  const { user } = await seedUser(db, "admin");
  await assert.rejects(setPaused(deps(keypairSigner(Keypair.generate())), user.id, true), /config authority/);
  assert.equal(sent.length, 0);
});
