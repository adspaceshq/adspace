import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { createProgram } from "../src/chain/program.js";
import { prepareChainTx, submitPreparedChainTx, type ChainTxRequest } from "../src/chain/runner.js";
import * as multisig from "@sqds/multisig";
import { keypairSigner } from "../src/chain/signers.js";
import { squadsProposalInstructions, squadsVault, type SquadsProposer } from "../src/chain/squads.js";
import type { Db } from "../src/db/client.js";
import { chainTxs } from "../src/db/schema.js";
import {
  prepareGuardianPause,
  setDisputeTimeout,
  setPaused,
  submitGuardianPause,
  type AdminDeps,
  type GuardianPauseDeps,
  type ProtocolStatus,
} from "../src/services/admin.js";
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

test("with the multisig as config authority, a dispute timeout change opens a Squads proposal", async () => {
  const { user } = await seedUser(db, "admin");
  status = { ...status, authority: vaultKey };
  await assert.rejects(setDisputeTimeout(deps(), user.id, 2 * 24 * 60 * 60), /changing the dispute timeout needs the multisig/);
  const result = await setDisputeTimeout({ ...deps(), squads }, user.id, 2 * 24 * 60 * 60);
  assert.equal(result.pending?.transactionIndex, 9);
  // Unchanged until the multisig executes it.
  assert.equal(result.status.disputeTimeoutSeconds, 3 * 24 * 60 * 60);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op, "squads_proposal");
  assert.ok(sent[0].instructions.every((ix) => ix.programId.equals(multisig.PROGRAM_ID)));
});

test("a dispute timeout proposal refuses a multisig that isn't the config authority", async () => {
  const { user } = await seedUser(db, "admin");
  status = { ...status, authority: Keypair.generate().publicKey };
  await assert.rejects(setDisputeTimeout({ ...deps(), squads }, user.id, 2 * 24 * 60 * 60), /is not the SQUADS_MULTISIG vault/);
  assert.equal(sent.length, 0);
});

// ---------- emergency pause by the guardian's own wallet ----------

const guardianKey = Keypair.generate();

// Just enough of a Connection for prepare/submit; a send pauses the protocol like guardian_pause would.
function guardianConnection(sentRaw: Buffer[]) {
  return {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1000 }),
    getBlockHeight: async () => 10,
    sendRawTransaction: async (raw: Buffer) => {
      sentRaw.push(raw);
      status = { ...status, paused: true };
      return "sig";
    },
    confirmTransaction: async () => ({ value: { err: null } }),
  } as unknown as Connection;
}

const guardianDeps = (sentRaw: Buffer[]): GuardianPauseDeps => {
  const connection = guardianConnection(sentRaw);
  return {
    db,
    program: createProgram(connection),
    readProtocolStatus: async () => status,
    prepareTx: (request) => prepareChainTx(db, connection, request),
    submitTx: (chainTxId, signed) => submitPreparedChainTx(db, connection, chainTxId, signed),
  };
};

const signWith = (base64: string, ...signers: Keypair[]) => {
  const tx = Transaction.from(Buffer.from(base64, "base64"));
  tx.partialSign(...signers);
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
};

test("guardian pause: prepares an unsigned guardian_pause paid for by the guardian, then submits what it signed", async () => {
  const { user } = await seedUser(db, "admin");
  status = { ...status, authority: vaultKey, pauseGuardian: guardianKey.publicKey };
  const sentRaw: Buffer[] = [];
  const deps = guardianDeps(sentRaw);

  const prepared = await prepareGuardianPause(deps, user.id, guardianKey.publicKey.toBase58());
  const unsigned = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  assert.ok(unsigned.feePayer?.equals(guardianKey.publicKey));
  assert.equal(unsigned.instructions.length, 1);
  assert.ok(unsigned.instructions[0].programId.equals(deps.program.programId));
  assert.equal(unsigned.signatures.length, 1);
  assert.equal(unsigned.signatures[0].signature, null);

  // Unsigned: refused before anything is sent.
  await assert.rejects(submitGuardianPause(deps, user.id, prepared.chainTxId, prepared.transaction), /missing the guardian's signature/);
  assert.equal(sentRaw.length, 0);

  const result = await submitGuardianPause(deps, user.id, prepared.chainTxId, signWith(prepared.transaction, guardianKey));
  assert.equal(sentRaw.length, 1);
  assert.equal(result.status.paused, true);
  const [row] = await db.select().from(chainTxs).where(eq(chainTxs.id, prepared.chainTxId));
  assert.equal(row.op, "pause_protocol");
  assert.equal(row.status, "confirmed");
  assert.equal(row.actorId, user.id);
  assert.equal(row.signature, result.signature);
});

test("guardian pause: refuses wallets that aren't the on-chain guardian, and a missing guardian or paused protocol", async () => {
  const { user } = await seedUser(db, "admin");
  const deps = guardianDeps([]);
  await assert.rejects(prepareGuardianPause(deps, user.id, guardianKey.publicKey.toBase58()), /no pause guardian is set/);
  status = { ...status, pauseGuardian: guardianKey.publicKey };
  await assert.rejects(
    prepareGuardianPause(deps, user.id, Keypair.generate().publicKey.toBase58()),
    (error: Error & { status?: number }) => error.status === 409 && error.message.includes("not the pause guardian"),
  );
  await assert.rejects(prepareGuardianPause(deps, user.id, "not-a-key"), /valid wallet address/);
  status = { ...status, paused: true };
  await assert.rejects(prepareGuardianPause(deps, user.id, guardianKey.publicKey.toBase58()), /already paused/);
});

test("guardian pause: rejects extra instructions, other signers, and other admins' transactions", async () => {
  const { user } = await seedUser(db, "admin");
  const other = await seedUser(db, "admin");
  status = { ...status, pauseGuardian: guardianKey.publicKey };
  const sentRaw: Buffer[] = [];
  const deps = guardianDeps(sentRaw);
  const prepared = await prepareGuardianPause(deps, user.id, guardianKey.publicKey.toBase58());
  const base = () => Transaction.from(Buffer.from(prepared.transaction, "base64"));

  // An extra instruction riding along, signed by the guardian.
  const extra = base();
  extra.add(SystemProgram.transfer({ fromPubkey: guardianKey.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 }));
  extra.partialSign(guardianKey);
  await assert.rejects(submitGuardianPause(deps, user.id, prepared.chainTxId, extra.serialize().toString("base64")), /only the guardian pause/);

  // Someone else pays and signs next to the guardian.
  const attacker = Keypair.generate();
  const otherPayer = base();
  otherPayer.feePayer = attacker.publicKey;
  otherPayer.partialSign(attacker, guardianKey);
  await assert.rejects(submitGuardianPause(deps, user.id, prepared.chainTxId, otherPayer.serialize().toString("base64")), /signed by the pause guardian only/);

  // A guardian_pause for a different key, signed by that key.
  const impostor = await prepareGuardianPause({ ...deps, readProtocolStatus: async () => ({ ...status, pauseGuardian: attacker.publicKey }) }, user.id, attacker.publicKey.toBase58());
  await assert.rejects(submitGuardianPause(deps, user.id, prepared.chainTxId, signWith(impostor.transaction, attacker)), /only the guardian pause/);

  // Only the admin who prepared it can submit it.
  await assert.rejects(submitGuardianPause(deps, other.user.id, prepared.chainTxId, signWith(prepared.transaction, guardianKey)), /not found/);
  await assert.rejects(submitGuardianPause(deps, user.id, prepared.chainTxId, "not base64 at all"), /could not be read/);
  assert.equal(sentRaw.length, 0);
});
