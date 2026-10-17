import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { eq } from "drizzle-orm";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import * as multisig from "@sqds/multisig";
import { createProgram } from "../src/chain/program.js";
import type { ChainTxRequest } from "../src/chain/runner.js";
import { keypairSigner } from "../src/chain/signers.js";
import { squadsProposalInstructions, squadsVault, type SquadsProposalStatus, type SquadsProposer } from "../src/chain/squads.js";
import type { Db } from "../src/db/client.js";
import { chainTxs, disputes, settlements, spotEvents, spots } from "../src/db/schema.js";
import { ChainError } from "../src/chain/errors.js";
import {
  BUYER_DISPUTE_MIN_LAMPORTS,
  DisputeError,
  raiseDispute,
  resolveDispute,
  staleSquadsProposals,
  timeoutDispute,
  withdrawDispute,
  type DisputeDeps,
  type StaleSquadsProposal,
} from "../src/services/disputes.js";
import { reconcile, type ChainSpotStatus } from "../src/services/reconciler.js";
import { reviewSummary } from "../src/services/dashboards.js";
import { createTestDb } from "./helpers/db.js";
import { fakeRunTx, seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
const REASON = "the sticker was never placed on the laptop";

let db: Db;
let close: () => Promise<void>;
let sent: ChainTxRequest[];
let timeoutSeconds: number;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());
beforeEach(() => {
  sent = [];
  timeoutSeconds = 3 * 24 * 60 * 60;
});

const reviewerKey = keypairSigner(Keypair.generate());
const deps = (now = new Date()): DisputeDeps => ({
  db,
  program: createProgram(new Connection("http://127.0.0.1:8899")),
  mint: Keypair.generate().publicKey,
  feePayer: reviewerKey,
  resolver: reviewerKey,
  rentPayer: reviewerKey,
  runTx: fakeRunTx(db, sent),
  readListingSnapshot: async () => ({
    treasury: Keypair.generate().publicKey,
    fees: { mode: "fixed", feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 },
  }),
  readVaultBalance: async () => 100n * USDC,
  accountExists: async () => true,
  readDisputeTimeoutSeconds: async () => timeoutSeconds,
  listingBaseUrl: "https://adspaces.fun",
  now: () => now,
});

// Delivery deadline passed one hour ago; spot funded without proof.
async function overdueSpot() {
  return seedListing(db, {
    deadline: new Date(Date.now() - 48 * HOUR),
    deliveryDueAt: new Date(Date.now() - HOUR),
    funded: true,
  });
}

test("buyer raises a dispute after the delivery deadline", async () => {
  const { buyer, spot } = await overdueSpot();
  const result = await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(result.spot.state, "disputed");
  assert.equal(result.dispute.state, "open");
  assert.equal(sent[0].op, "raise_dispute");
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [buyer!.signer.publicKey.toBase58()]);
});

test("a separate platform rent payer co-signs the dispute and receives rent on timeout", async () => {
  const { buyer, spot, seller } = await overdueSpot();
  const rentPayer = keypairSigner(Keypair.generate());
  const withRentPayer = (now?: Date) => ({ ...deps(now), rentPayer });
  await raiseDispute(withRentPayer(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [buyer!.signer.publicKey.toBase58(), rentPayer.publicKey.toBase58()]);
  timeoutSeconds = 0;
  await timeoutDispute(withRentPayer(), spot.id);
  const keys = sent[1].instructions.at(-1)!.keys;
  assert.ok(keys.some((key) => key.pubkey.equals(rentPayer.publicKey) && key.isWritable));
  // The creator's wallet is no longer part of a timeout.
  assert.ok(!keys.some((key) => key.pubkey.toBase58() === seller.user.walletAddress));
});

test("disputes are blocked before delivery is due, for non-buyers, and with thin reasons", async () => {
  const early = await seedListing(db, {
    deadline: new Date(Date.now() - HOUR),
    deliveryDueAt: new Date(Date.now() + 24 * HOUR),
    funded: true,
  });
  await assert.rejects(raiseDispute(deps(), early.buyer!.user.id, early.buyer!.signer, early.spot.id, { reason: REASON }), /after the delivery deadline/);
  const { seller, buyer, spot } = await overdueSpot();
  await assert.rejects(raiseDispute(deps(), seller.user.id, seller.signer, spot.id, { reason: REASON }), /only the sponsor/);
  await assert.rejects(raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: "bad" }), /10-2000/);
  assert.equal(sent.length, 0);
});

test("a withdrawn dispute returns the spot and can be raised again", async () => {
  const { buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  const withdrawn = await withdrawDispute(deps(), buyer!.user.id, buyer!.signer, spot.id);
  assert.equal(withdrawn.spot.state, "funded");
  const again = await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(again.spot.state, "disputed");
  assert.deepEqual(sent.map((tx) => tx.idempotencyKey.split(":")[0]), ["dispute", "withdraw-dispute", "dispute"]);
  const history = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.deepEqual(history.map((row) => row.state).sort(), ["open", "withdrawn"]);
});

test("reviewers resolve with a split that adds up; parties can't resolve", async () => {
  const { seller, buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  const decision = { sellerShareBps: 5000, decision: "half delivered, photos show partial placement" };
  await assert.rejects(resolveDispute(deps(), seller.user.id, spot.id, decision), /part of/);
  await assert.rejects(resolveDispute(deps(), buyer!.user.id, spot.id, decision), /part of/);
  const reviewer = await seedUser(db, "reviewer");
  const result = await resolveDispute(deps(), reviewer.user.id, spot.id, decision);
  assert.equal(result.spot.state, "settled");
  const { gross, fee, sellerNet, buyerRefund } = result.settlement;
  assert.equal(fee + sellerNet + buyerRefund, gross);
  assert.equal(buyerRefund, 50n * USDC);
  assert.equal(fee, 25n * USDC / 10n);
  const [closed] = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.equal(closed.state, "resolved");
  assert.equal(closed.resolvedBy, reviewer.user.id);
});

test("unresolved disputes refund the buyer once the configured timeout passes", async () => {
  const { buyer, spot } = await overdueSpot();
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  await assert.rejects(timeoutDispute(deps(), spot.id), /auto-refund opens/);
  timeoutSeconds = 60;
  const result = await timeoutDispute(deps(new Date(Date.now() + 61_000)), spot.id);
  assert.equal(result.spot.state, "refunded");
  assert.equal(result.settlement.buyerRefund, 100n * USDC);
  assert.equal(result.settlement.fee, 0n);
  const [stored] = await db.select().from(settlements).where(eq(settlements.spotId, spot.id));
  assert.equal(stored.kind, "timeout_refund");
  const [refunded] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(refunded.state, "refunded");
});

// ---------- config authority is a Squads vault ----------

const multisigKey = Keypair.generate().publicKey;
const vaultKey = squadsVault(multisigKey);
const proposerKey = keypairSigner(Keypair.generate());

// Builds real Squads instructions; only the multisig account read (the next index) is faked.
function fakeSquads(statuses: Map<bigint, SquadsProposalStatus>, proposed: TransactionInstruction[][], firstIndex = 7n): SquadsProposer {
  let next = firstIndex;
  return {
    multisig: multisigKey,
    vault: vaultKey,
    proposer: proposerKey,
    propose: async (instructions, memo) => {
      proposed.push(instructions);
      const transactionIndex = next++;
      return squadsProposalInstructions({ multisig: multisigKey, proposer: proposerKey.publicKey, transactionIndex, instructions, memo });
    },
    proposalStatus: async (index) => statuses.get(index) ?? null,
  };
}

const viaSquads = (proposed: TransactionInstruction[][] = [], statuses = new Map<bigint, SquadsProposalStatus>(), firstIndex = 7n): DisputeDeps => ({
  ...deps(),
  readConfigAuthority: async () => vaultKey,
  squads: fakeSquads(statuses, proposed, firstIndex),
});

async function disputedSpot() {
  const seeded = await overdueSpot();
  await raiseDispute(deps(), seeded.buyer!.user.id, seeded.buyer!.signer, seeded.spot.id, { reason: REASON });
  sent.length = 0;
  return { ...seeded, reviewer: await seedUser(db, "reviewer") };
}

const DECISION = { sellerShareBps: 5000, decision: "half delivered, photos show partial placement" };

test("with a Squads vault as config authority, resolving opens a proposal and keeps the dispute open", async () => {
  const { spot, reviewer } = await disputedSpot();
  const statuses = new Map<bigint, SquadsProposalStatus>();
  const proposed: TransactionInstruction[][] = [];

  const result = await resolveDispute(viaSquads(proposed, statuses), reviewer.user.id, spot.id, DECISION);
  assert.ok("pending" in result);
  assert.equal(result.pending.transactionIndex, 7);
  assert.equal(result.pending.url, "https://backup.app.squads.so");
  assert.equal(result.pending.proposal, multisig.getProposalPda({ multisigPda: multisigKey, transactionIndex: 7n })[0].toBase58());

  // The server only sends vault_transaction_create + proposal_create, signed by the proposer.
  assert.equal(sent.length, 1);
  assert.equal(sent[0].op, "squads_proposal");
  assert.deepEqual(
    sent[0].instructions.map((ix) => ix.programId.toBase58()),
    [multisig.PROGRAM_ID.toBase58(), multisig.PROGRAM_ID.toBase58()],
  );
  assert.deepEqual(sent[0].signers?.map((signer) => signer.publicKey.toBase58()), [proposerKey.publicKey.toBase58()]);
  // Fits one legacy transaction (1232 bytes) with both signatures.
  const outer = new Transaction({ feePayer: reviewerKey.publicKey, recentBlockhash: PublicKey.default.toBase58() }).add(...sent[0].instructions);
  const size = outer.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
  assert.ok(size <= 1232);
  // The wrapped resolve_dispute names the vault as resolver, a signer the vault provides on execute.
  assert.equal(proposed[0].length, 1);
  const [resolve] = proposed[0];
  assert.ok(resolve.keys[0].pubkey.equals(vaultKey) && resolve.keys[0].isSigner);

  const [row] = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.equal(row.state, "open");
  assert.equal(row.squadsTransactionIndex, 7);
  assert.equal(row.squadsMultisig, multisigKey.toBase58());
  assert.equal(row.squadsProposal, result.pending.proposal);
  assert.equal(row.proposedSellerShareBps, 5000);
  assert.equal(row.proposedBy, reviewer.user.id);
  assert.match(row.decisionHash!, /^[0-9a-f]{64}$/);
  assert.match(row.decisionUri!, /#decision-1$/);
  assert.equal(row.sellerShareBps, null);
  const [stillDisputed] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(stillDisputed.state, "disputed");
  assert.equal((await db.select().from(settlements).where(eq(settlements.spotId, spot.id))).length, 0);

  // A live proposal blocks a second one; a rejected one can be replaced.
  statuses.set(7n, "active");
  await assert.rejects(resolveDispute(viaSquads([], statuses), reviewer.user.id, spot.id, DECISION), /waiting for multisig approval \(Squads #7\)/);
  statuses.set(7n, "rejected");
  const again = await resolveDispute(viaSquads([], statuses, 8n), reviewer.user.id, spot.id, DECISION);
  assert.ok("pending" in again);
  assert.equal(again.pending.transactionIndex, 8);
});

test("missing token accounts are created by the platform before the proposal", async () => {
  const { spot, reviewer } = await disputedSpot();
  const proposed: TransactionInstruction[][] = [];
  await resolveDispute({ ...viaSquads(proposed), accountExists: async () => false }, reviewer.user.id, spot.id, DECISION);
  assert.deepEqual(sent.map((tx) => tx.idempotencyKey.split(":")[0]), ["squads-resolve-atas", "squads-resolve"]);
  assert.equal(sent[0].instructions.length, 3);
  assert.equal(proposed[0].length, 1);
});

test("without SQUADS_MULTISIG a server key that is not the config authority can't resolve", async () => {
  const { spot, reviewer } = await disputedSpot();
  await assert.rejects(
    resolveDispute({ ...deps(), readConfigAuthority: async () => vaultKey }, reviewer.user.id, spot.id, DECISION),
    (error: Error & { status?: number }) => error.status === 409 && /needs the multisig; set SQUADS_MULTISIG/.test(error.message),
  );
  // A multisig whose vault isn't the authority is refused too.
  await assert.rejects(
    resolveDispute({ ...viaSquads(), readConfigAuthority: async () => Keypair.generate().publicKey }, reviewer.user.id, spot.id, DECISION),
    /is not the SQUADS_MULTISIG vault/,
  );
  assert.equal(sent.length, 0);
  // The server key as authority still resolves directly, even with a multisig configured.
  const direct = await resolveDispute({ ...viaSquads(), readConfigAuthority: async () => reviewerKey.publicKey }, reviewer.user.id, spot.id, DECISION);
  assert.equal(direct.spot.state, "settled");
  assert.equal(sent[0].op, "resolve_dispute");
});

test("the reconciler settles a dispute once the multisig executes the resolution", async () => {
  const { spot, reviewer } = await disputedSpot();
  await resolveDispute(viaSquads(), reviewer.user.id, spot.id, DECISION);
  const [proposed] = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));

  let chainStatus: ChainSpotStatus = "disputed";
  let lookups = 0;
  const executed = `sig-squads-${proposed.id}`;
  const reconcileDeps = () => ({
    db,
    signatureOutcomes: async () => new Map(),
    // Other tests' proposals are still waiting on the multisig.
    readSpotStatus: async (address: string): Promise<ChainSpotStatus> => (address === spot.chainAddress ? chainStatus : "disputed"),
    findDisputeResolution: async (address: string, hash: string) => {
      if (address !== spot.chainAddress) return null;
      lookups += 1;
      if (hash !== proposed.decisionHash) return null;
      return {
        signature: executed,
        event: {
          decisionHash: Array.from(Buffer.from(hash, "hex")),
          sellerShareBps: 5000,
          buyerRefund: "50000000",
          sellerAmount: "47500000",
          fee: "2500000",
        },
      };
    },
  });

  // Still waiting for approval: nothing changes and the chain isn't searched.
  const waiting = await reconcile(reconcileDeps());
  assert.equal(waiting.disputesResolved, 0);
  assert.equal(lookups, 0);
  assert.equal((await db.select().from(disputes).where(eq(disputes.id, proposed.id)))[0].state, "open");

  chainStatus = "closed";
  const report = await reconcile(reconcileDeps());
  assert.equal(report.disputesResolved, 1);
  assert.ok(!report.spotDrift.some((drift) => drift.spotId === spot.id));

  const [resolved] = await db.select().from(disputes).where(eq(disputes.id, proposed.id));
  assert.equal(resolved.state, "resolved");
  assert.equal(resolved.sellerShareBps, 5000);
  assert.equal(resolved.decision, DECISION.decision);
  assert.equal(resolved.resolvedBy, reviewer.user.id);
  const [settled] = await db.select().from(spots).where(eq(spots.id, spot.id));
  assert.equal(settled.state, "settled");
  const [settlement] = await db.select().from(settlements).where(eq(settlements.spotId, spot.id));
  assert.equal(settlement.kind, "dispute_split");
  assert.equal(settlement.buyerRefund, 50n * USDC);
  assert.equal(settlement.sellerNet, (475n * USDC) / 10n);
  assert.equal(settlement.fee, (25n * USDC) / 10n);
  assert.equal(settlement.gross, 100n * USDC);
  const [tx] = await db.select().from(chainTxs).where(eq(chainTxs.id, settlement.chainTxId));
  assert.equal(tx.signature, executed);
  assert.equal(tx.op, "resolve_dispute");
  assert.equal(tx.status, "confirmed");
  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.ok(events.some((event) => event.type === "dispute_resolved" && event.chainTxId === tx.id));

  // Settled once: a later run finds nothing to do.
  assert.equal((await reconcile(reconcileDeps())).disputesResolved, 0);
});

test("a dispute closed on-chain without our decision is left for drift detection", async () => {
  const { spot, reviewer } = await disputedSpot();
  await resolveDispute(viaSquads(), reviewer.user.id, spot.id, DECISION);
  const report = await reconcile({
    db,
    signatureOutcomes: async () => new Map(),
    readSpotStatus: async (address: string): Promise<ChainSpotStatus> => (address === spot.chainAddress ? "closed" : "open"),
    findDisputeResolution: async () => null,
  });
  assert.equal(report.disputesResolved, 0);
  assert.ok(report.spotDrift.some((drift) => drift.spotId === spot.id && drift.dbState === "disputed"));
  const [row] = await db.select().from(disputes).where(eq(disputes.spotId, spot.id));
  assert.equal(row.state, "open");
});

// ---------- CertiK changes: dispute rent payer, resolve before timeout, buyer-paid fallback ----------

const keyAt = (ix: TransactionInstruction, index: number) => ix.keys[index].pubkey.toBase58();
// Account positions from the IDL: rent_payer then dispute_rent_payer in resolve and timeout.
const RENT_PAYER = 5;
const DISPUTE_RENT_PAYER = 6;
const WITHDRAW_RENT_PAYER = 4;
const RAISE_RENT_PAYER = 4;

test("resolve is refused once the dispute has timed out; nothing is sent", async () => {
  const { spot, reviewer } = await disputedSpot();
  timeoutSeconds = 0;
  await assert.rejects(resolveDispute(deps(new Date(Date.now() + 1000)), reviewer.user.id, spot.id, DECISION), /timed out and can no longer be resolved/);
  assert.equal(sent.length, 0);
});

test("a Squads resolve needs at least 6 hours before the on-chain timeout", async () => {
  const { spot, reviewer } = await disputedSpot();
  const now = new Date();
  const record = (hours: number) => async () => ({ rentPayer: reviewerKey.publicKey, timesOutAt: new Date(now.getTime() + hours * HOUR) });
  await assert.rejects(
    resolveDispute({ ...viaSquads(), now: () => now, readDisputeRecord: record(5) }, reviewer.user.id, spot.id, DECISION),
    /only 5h 0m left before this dispute times out at .*needs at least 6 hours/,
  );
  assert.equal(sent.length, 0);
  const proposed: TransactionInstruction[][] = [];
  const result = await resolveDispute({ ...viaSquads(proposed), now: () => now, readDisputeRecord: record(7) }, reviewer.user.id, spot.id, DECISION);
  assert.ok("pending" in result && "timesOutAt" in result);
  assert.equal(result.timesOutAt.getTime(), now.getTime() + 7 * HOUR);
  // The proposed resolve names the dispute's rent payer right after the listing's rent payer.
  assert.equal(keyAt(proposed[0][0], DISPUTE_RENT_PAYER), reviewerKey.publicKey.toBase58());
});

test("resolve, timeout and withdraw return the dispute rent to whoever the chain says paid it", async () => {
  const buyerPaid = Keypair.generate().publicKey;
  const onChain = (now?: Date): DisputeDeps => ({ ...deps(now), readDisputeRecord: async () => ({ rentPayer: buyerPaid, timesOutAt: new Date(Date.now() + HOUR) }) });

  const resolved = await disputedSpot();
  await resolveDispute(onChain(), resolved.reviewer.user.id, resolved.spot.id, DECISION);
  const resolveIx = sent.at(-1)!.instructions.at(-1)!;
  assert.equal(keyAt(resolveIx, RENT_PAYER), reviewerKey.publicKey.toBase58());
  assert.equal(keyAt(resolveIx, DISPUTE_RENT_PAYER), buyerPaid.toBase58());
  assert.ok(resolveIx.keys[DISPUTE_RENT_PAYER].isWritable);

  const timedOut = await disputedSpot();
  // The chain's own timeout counts, not the config value.
  await assert.rejects(timeoutDispute(onChain(), timedOut.spot.id), /auto-refund opens/);
  await timeoutDispute(onChain(new Date(Date.now() + 2 * HOUR)), timedOut.spot.id);
  assert.equal(keyAt(sent.at(-1)!.instructions.at(-1)!, DISPUTE_RENT_PAYER), buyerPaid.toBase58());

  const withdrawn = await disputedSpot();
  await withdrawDispute(onChain(), withdrawn.buyer!.user.id, withdrawn.buyer!.signer, withdrawn.spot.id);
  assert.equal(keyAt(sent.at(-1)!.instructions[0], WITHDRAW_RENT_PAYER), buyerPaid.toBase58());

  // A dispute already gone on-chain is left to reconciliation.
  const gone = await disputedSpot();
  await assert.rejects(timeoutDispute({ ...deps(), readDisputeRecord: async () => null }, gone.spot.id), /no longer open on-chain/);
});

// Delivery was due an hour ago and the creator posted proof: the review window is open.
async function provenSpot() {
  const seeded = await overdueSpot();
  await db.update(spots).set({ state: "delivered", proofSubmittedAt: new Date(Date.now() - 2 * HOUR), proofHash: "ab" }).where(eq(spots.id, seeded.spot.id));
  return seeded;
}

const outOfSol = () => new ChainError("not enough SOL to cover network fees or rent for this transaction");
// Fails while the platform pays; succeeds once the buyer pays.
const platformBroke = (): DisputeDeps["runTx"] => {
  const run = fakeRunTx(db, sent);
  return async (request) => {
    if (request.feePayer.publicKey.equals(reviewerKey.publicKey)) throw outOfSol();
    return run(request);
  };
};

test("when the platform can't pay, a buyer with SOL pays the dispute rent and gets it back", async () => {
  const { buyer, spot } = await provenSpot();
  const buyerKey = buyer!.signer.publicKey;
  const fallback: DisputeDeps = {
    ...deps(),
    runTx: platformBroke(),
    buyerPaidDisputes: true,
    readLamports: async () => [BUYER_DISPUTE_MIN_LAMPORTS],
  };
  const result = await raiseDispute(fallback, buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(result.buyerPaidRent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].idempotencyKey, /:buyer-paid$/);
  assert.ok(sent[0].feePayer.publicKey.equals(buyerKey));
  assert.equal(sent[0].signers, undefined);
  assert.equal(keyAt(sent[0].instructions[0], RAISE_RENT_PAYER), buyerKey.toBase58());
  const [raised] = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  assert.equal((raised.data as { rentPayer: string }).rentPayer, buyerKey.toBase58());

  // Without a chain reader, the payer recorded at raise gets the rent back on timeout.
  timeoutSeconds = 0;
  await timeoutDispute(deps(new Date(Date.now() + 1000)), spot.id);
  assert.equal(keyAt(sent.at(-1)!.instructions.at(-1)!, DISPUTE_RENT_PAYER), buyerKey.toBase58());
});

test("the buyer-paid fallback needs the flag, proof and enough SOL", async () => {
  const proven = await provenSpot();
  const base = (): DisputeDeps => ({ ...deps(), runTx: platformBroke(), readLamports: async () => [1_000_000] });
  const raise = (extra: Partial<DisputeDeps>, seeded = proven) =>
    raiseDispute({ ...base(), ...extra }, seeded.buyer!.user.id, seeded.buyer!.signer, seeded.spot.id, { reason: REASON });
  await assert.rejects(raise({}), (error: DisputeError) => error.status === 503 && /try again later/.test(error.message));
  await assert.rejects(raise({ buyerPaidDisputes: true }), /open it yourself with 0\.0053 SOL in your wallet .*you have 0\.0010 SOL/);
  // No proof: the program only lets the platform pay, so the fallback isn't offered.
  const unproven = await overdueSpot();
  await assert.rejects(raise({ buyerPaidDisputes: true, readLamports: async () => [10 ** 9] }, unproven), /try again later/);
  assert.equal(sent.length, 0);
});

test("a platform signing failure falls back; a buyer signing failure does not", async () => {
  const { buyer, spot } = await provenSpot();
  const broken = {
    publicKey: reviewerKey.publicKey,
    sign: async (): Promise<Transaction> => {
      throw new Error("signer offline");
    },
  };
  // Signs like the real runner: extra signers first, then the fee payer.
  const signingRunTx: DisputeDeps["runTx"] = async (request) => {
    const transaction = new Transaction({ feePayer: request.feePayer.publicKey, recentBlockhash: PublicKey.default.toBase58() }).add(...request.instructions);
    for (const signer of request.signers ?? []) await signer.sign(transaction);
    await request.feePayer.sign(transaction);
    return fakeRunTx(db, sent)(request);
  };
  const withSigners = (platform: typeof broken | typeof reviewerKey): DisputeDeps => ({
    ...deps(),
    feePayer: platform,
    rentPayer: platform,
    runTx: signingRunTx,
    buyerPaidDisputes: true,
    readLamports: async () => [10 ** 9],
  });
  const lockedBuyer = {
    publicKey: buyer!.signer.publicKey,
    sign: async (): Promise<Transaction> => {
      throw new Error("buyer wallet locked");
    },
  };
  await assert.rejects(raiseDispute(withSigners(reviewerKey), buyer!.user.id, lockedBuyer, spot.id, { reason: REASON }), /buyer wallet locked/);
  assert.equal(sent.length, 0);
  const result = await raiseDispute(withSigners(broken), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  assert.equal(result.buyerPaidRent, true);
  assert.equal(result.spot.state, "disputed");
  assert.ok(sent[0].feePayer.publicKey.equals(buyer!.signer.publicKey));
});

// ---------- second CertiK scan: decisions bound to a dispute instance, withdraw before timeout ----------

const coder = createProgram(new Connection("http://127.0.0.1:8899")).coder.instruction;
type ResolveArgs = { sellerShareBps: number; expectedOpenedAt: { toNumber(): number }; expectedEvidenceHash: number[] };
const decodeResolve = (ix: TransactionInstruction) => {
  const decoded = coder.decode(Buffer.from(ix.data));
  assert.equal(decoded?.name, "resolveDispute");
  return decoded!.data as ResolveArgs;
};
const raisedEvidenceHash = (ix: TransactionInstruction) => {
  const decoded = coder.decode(Buffer.from(ix.data));
  assert.equal(decoded?.name, "raiseDispute");
  return Array.from((decoded!.data as { evidenceHash: number[] }).evidenceHash);
};

test("resolve passes the on-chain opened_at and evidence_hash, directly and in a Squads proposal", async () => {
  const evidenceHash = Array.from({ length: 32 }, (_, i) => i + 1);
  const record = async () => ({ rentPayer: reviewerKey.publicKey, timesOutAt: new Date(Date.now() + 24 * HOUR), openedAt: 1_760_000_123, evidenceHash });

  const direct = await disputedSpot();
  await resolveDispute({ ...deps(), readDisputeRecord: record }, direct.reviewer.user.id, direct.spot.id, DECISION);
  const args = decodeResolve(sent.at(-1)!.instructions.at(-1)!);
  assert.equal(args.sellerShareBps, 5000);
  assert.equal(args.expectedOpenedAt.toNumber(), 1_760_000_123);
  assert.deepEqual(Array.from(args.expectedEvidenceHash), evidenceHash);

  const proposed: TransactionInstruction[][] = [];
  const viaMultisig = await disputedSpot();
  await resolveDispute({ ...viaSquads(proposed), readDisputeRecord: record }, viaMultisig.reviewer.user.id, viaMultisig.spot.id, DECISION);
  const wrapped = decodeResolve(proposed[0][0]);
  assert.equal(wrapped.expectedOpenedAt.toNumber(), 1_760_000_123);
  assert.deepEqual(Array.from(wrapped.expectedEvidenceHash), evidenceHash);
});

test("without the chain record, resolve falls back to the DB open time and the hash raise_dispute sent", async () => {
  const seeded = await overdueSpot();
  await raiseDispute(deps(), seeded.buyer!.user.id, seeded.buyer!.signer, seeded.spot.id, { reason: REASON });
  const raisedHash = raisedEvidenceHash(sent[0].instructions[0]);
  const reviewer = await seedUser(db, "reviewer");
  await resolveDispute(deps(), reviewer.user.id, seeded.spot.id, DECISION);
  const [row] = await db.select().from(disputes).where(eq(disputes.spotId, seeded.spot.id));
  const args = decodeResolve(sent.at(-1)!.instructions.at(-1)!);
  assert.equal(args.expectedOpenedAt.toNumber(), Math.floor(row.openedAt.getTime() / 1000));
  assert.deepEqual(Array.from(args.expectedEvidenceHash), raisedHash);
});

test("a withdrawal is refused once the dispute has timed out; nothing is sent", async () => {
  const { buyer, spot } = await disputedSpot();
  const timedOut = async () => ({ rentPayer: reviewerKey.publicKey, timesOutAt: new Date(Date.now() - 1000) });
  await assert.rejects(
    withdrawDispute({ ...deps(), readDisputeRecord: timedOut }, buyer!.user.id, buyer!.signer, spot.id),
    (error: DisputeError) => error.status === 409 && /timed out, so it can't be withdrawn anymore/.test(error.message),
  );
  assert.equal(sent.length, 0);
  // Just before the timeout it still goes through.
  const justBefore = async () => ({ rentPayer: reviewerKey.publicKey, timesOutAt: new Date(Date.now() + 60_000) });
  const result = await withdrawDispute({ ...deps(), readDisputeRecord: justBefore }, buyer!.user.id, buyer!.signer, spot.id);
  assert.equal(result.spot.state, "funded");
});

test("withdrawing a dispute with a pending Squads resolve marks the proposal stale for cancelling", async () => {
  const { spot, buyer, reviewer } = await disputedSpot();
  const result = await resolveDispute(viaSquads([], new Map(), 41n), reviewer.user.id, spot.id, DECISION);
  assert.ok("pending" in result);
  await withdrawDispute(deps(), buyer!.user.id, buyer!.signer, spot.id);

  const events = await db.select().from(spotEvents).where(eq(spotEvents.spotId, spot.id));
  const withdrawn = events.find((event) => event.type === "dispute_withdrawn");
  assert.equal((withdrawn?.data as { staleSquadsTransactionIndex?: number }).staleSquadsTransactionIndex, 41);

  const mine = (list: StaleSquadsProposal[]) => list.filter((item) => item.spotId === spot.id);
  // Without a Squads reader, recently closed disputes are listed.
  const [listed] = mine(await staleSquadsProposals(db));
  assert.equal(listed.transactionIndex, 41);
  assert.equal(listed.disputeState, "withdrawn");
  assert.equal(listed.message, "the dispute was withdrawn; cancel Squads proposal #41");
  // With one, only proposals members could still approve or execute.
  for (const status of ["active", "approved", "draft", "executing"]) {
    assert.equal(mine(await staleSquadsProposals(db, { proposalStatus: async () => status })).length, 1, status);
  }
  for (const status of ["cancelled", "rejected", "executed", null]) {
    assert.equal(mine(await staleSquadsProposals(db, { proposalStatus: async () => status })).length, 0, String(status));
  }
  // A failed read keeps it listed rather than hiding a live proposal.
  const unreadable = mine(await staleSquadsProposals(db, { proposalStatus: () => Promise.reject(new Error("rpc down")) }));
  assert.equal(unreadable.length, 1);
  assert.equal(unreadable[0].status, null);

  // The re-raised dispute is a new row: the stale proposal doesn't block a new decision.
  await raiseDispute(deps(), buyer!.user.id, buyer!.signer, spot.id, { reason: REASON });
  const again = await resolveDispute(viaSquads([], new Map([[41n, "active" as const]]), 42n), reviewer.user.id, spot.id, DECISION);
  assert.ok("pending" in again && again.pending.transactionIndex === 42);
});

test("a dispute that times out with a pending Squads resolve is listed as stale too", async () => {
  const { spot, reviewer } = await disputedSpot();
  await resolveDispute(viaSquads([], new Map(), 77n), reviewer.user.id, spot.id, DECISION);
  timeoutSeconds = 0;
  await timeoutDispute(deps(new Date(Date.now() + 1000)), spot.id);
  const summary = await reviewSummary(db, new Date(), { timeoutSeconds: 60 }, { proposalStatus: async (index) => (index === 77n ? "active" : "cancelled") });
  const item = summary.staleProposals.find((entry) => entry.spotId === spot.id);
  assert.equal(item?.message, "the dispute timed out; cancel Squads proposal #77");
  assert.equal(item?.status, "active");
  assert.equal(summary.counts.staleProposals, summary.staleProposals.length);
});

test("settlement paths name the listing's on-chain rent payer; a proofless dispute waits for adoption", async () => {
  const adopted = keypairSigner(Keypair.generate());
  const former = Keypair.generate().publicKey;
  const snapshot = (rentPayer: PublicKey) => async () => ({
    treasury: Keypair.generate().publicKey,
    rentPayer,
    fees: { mode: "fixed" as const, feeBps: 500, upliftFeeBps: 0, maxFeeBps: 500 },
  });

  // Not yet adopted: the platform can't pay a proofless dispute's rent, so nothing is sent.
  const unadopted = await overdueSpot();
  await assert.rejects(
    raiseDispute({ ...deps(), readListingSnapshot: snapshot(former) }, unadopted.buyer!.user.id, unadopted.buyer!.signer, unadopted.spot.id, { reason: REASON }),
    (error: DisputeError) => error.status === 503 && /key change/.test(error.message),
  );
  assert.equal(sent.length, 0);
  // With proof any signer may pay, so the platform still opens it.
  const proven = await provenSpot();
  await raiseDispute({ ...deps(), readListingSnapshot: snapshot(former) }, proven.buyer!.user.id, proven.buyer!.signer, proven.spot.id, { reason: REASON });
  assert.equal(keyAt(sent.at(-1)!.instructions[0], RAISE_RENT_PAYER), reviewerKey.publicKey.toBase58());

  // Resolve and timeout return listing rent to whoever the listing names now.
  const resolved = await disputedSpot();
  await resolveDispute({ ...deps(), readListingSnapshot: snapshot(adopted.publicKey) }, resolved.reviewer.user.id, resolved.spot.id, DECISION);
  assert.equal(keyAt(sent.at(-1)!.instructions.at(-1)!, RENT_PAYER), adopted.publicKey.toBase58());
  const timedOut = await disputedSpot();
  timeoutSeconds = 0;
  await timeoutDispute({ ...deps(new Date(Date.now() + 1000)), readListingSnapshot: snapshot(former) }, timedOut.spot.id);
  assert.equal(keyAt(sent.at(-1)!.instructions.at(-1)!, RENT_PAYER), former.toBase58());
});
