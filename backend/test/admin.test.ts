import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { Connection, Keypair } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import * as multisig from "@sqds/multisig";
import { keypairSigner } from "../src/chain/signers.js";
import { squadsProposalInstructions, squadsVault, type SquadsProposer } from "../src/chain/squads.js";
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

const multisigKey = Keypair.generate().publicKey;
const vaultKey = squadsVault(multisigKey);
const guardian = Keypair.generate().publicKey;
const squads: SquadsProposer = {
  multisig: multisigKey,
  vault: vaultKey,
  proposer: authority,
  propose: async (instructions, memo) =>
    squadsProposalInstructions({ multisig: multisigKey, proposer: authority.publicKey, transactionIndex: 9n, instructions, memo }),
  proposalStatus: async () => "active",
};

test("with the multisig as config authority, pausing points to the guardian", async () => {
  const { user } = await seedUser(db, "admin");
  status = { ...status, authority: vaultKey, pauseGuardian: guardian };
  await assert.rejects(
    setPaused({ ...deps(), squads }, user.id, true),
    (error: Error & { status?: number }) => error.status === 409 && error.message.includes(`pause guardian (${guardian.toBase58()})`),
  );
  assert.equal(sent.length, 0);
});

test("with the multisig as config authority, resuming opens a Squads proposal", async () => {
  const { user } = await seedUser(db, "admin");
  status = { ...status, authority: vaultKey, paused: true };
  await assert.rejects(setPaused(deps(), user.id, false), /resuming needs the multisig; set SQUADS_MULTISIG/);
  const result = await setPaused({ ...deps(), squads }, user.id, false);
  assert.equal(result.pending?.transactionIndex, 9);
  assert.equal(result.pending?.url, "https://backup.app.squads.so");
  // Still paused until the multisig executes it.
  assert.equal(result.status.paused, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op, "squads_proposal");
  assert.ok(sent[0].instructions.every((ix) => ix.programId.equals(multisig.PROGRAM_ID)));
});
