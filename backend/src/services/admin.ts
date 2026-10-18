import { randomUUID } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { chainTxs, listings } from "../db/schema.js";
import { pdas, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult, PreparedChainTx } from "../chain/runner.js";
import { cosigners, externalSigner, type TxSigner } from "../chain/signers.js";
import { squadsPending, type SquadsPending, type SquadsProposer } from "../chain/squads.js";

export class AdminError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ProtocolStatus {
  authority: PublicKey;
  treasury: PublicKey;
  feeBps: number;
  paused: boolean;
  disputeTimeoutSeconds: number;
  // Can only pause (guardian_pause); null when not set up or disabled.
  pauseGuardian?: PublicKey | null;
}

export interface AdminDeps {
  db: Db;
  program: AdspacesProgram;
  // Signs directly when it is the program's config authority; always the fee payer.
  authority: TxSigner;
  // When the config authority is this multisig's vault, resuming becomes a Squads proposal.
  squads?: SquadsProposer;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readProtocolStatus: () => Promise<ProtocolStatus>;
  // The cluster clock (unix seconds) that the program checks valid_until against; local time when missing.
  readClusterTime?: () => Promise<number>;
  // How long an admin message (and so a Squads proposal) stays executable; default 24 hours, at most 7 days.
  adminMessageTtlHours?: number;
}

// The program accepts an admin message only while valid_until lies within [now, now + 7 days] of the
// cluster clock (MAX_ADMIN_MESSAGE_TTL_SECONDS), so an approved but unexecuted proposal dies on its own.
export const MAX_ADMIN_MESSAGE_TTL_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_ADMIN_MESSAGE_TTL_HOURS = 24;

async function adminMessageValidUntil(deps: Pick<AdminDeps, "readClusterTime" | "adminMessageTtlHours">): Promise<number> {
  const now = deps.readClusterTime ? await deps.readClusterTime() : Math.floor(Date.now() / 1000);
  const hours = deps.adminMessageTtlHours ?? DEFAULT_ADMIN_MESSAGE_TTL_HOURS;
  return now + Math.min(Math.max(1, Math.floor(hours)) * 3600, MAX_ADMIN_MESSAGE_TTL_SECONDS);
}

// Mirrors the program's bounds (production build); devnet allows shorter values on-chain.
export const MIN_DISPUTE_TIMEOUT_SECONDS = 60 * 60;
export const MAX_DISPUTE_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

export async function setPaused(
  deps: AdminDeps,
  adminId: string,
  paused: boolean,
): Promise<{ status: ProtocolStatus; signature: string | null; pending?: SquadsPending }> {
  const status = await deps.readProtocolStatus();
  // Also keeps an unpause from ever being sent while running: the program rejects it (ConfigMismatch).
  if (status.paused === paused) return { status, signature: null };
  if (!status.authority.equals(deps.authority.publicKey)) {
    // The multisig can pause too, but an emergency shouldn't wait for 2 of 3: that's the guardian's job.
    if (paused) {
      const guardian = status.pauseGuardian ? ` (${status.pauseGuardian.toBase58()})` : "";
      throw new AdminError(`the config authority is the multisig, so the server can't pause; the pause guardian${guardian} can, with emergency pause`, 409);
    }
    return proposeResume(deps, adminId, status);
  }
  const validUntil = await adminMessageValidUntil(deps);
  const instruction = await deps.program.methods
    .pauseProtocol(paused, new anchor.BN(validUntil))
    .accountsStrict({ authority: deps.authority.publicKey, config: pdas(deps.program.programId).config() })
    .instruction();
  // Admin toggles are deliberate one-offs; a fresh key per request keeps repeated toggles possible.
  const tx = await deps.runTx({
    op: "pause_protocol",
    idempotencyKey: `pause:${paused}:${randomUUID()}`,
    actorId: adminId,
    instructions: [instruction],
    feePayer: deps.authority,
  });
  return { status: await deps.readProtocolStatus(), signature: tx.signature };
}

// Only the config authority can resume, so with the multisig in charge the server opens a Squads proposal.
// The program only unpauses from paused (ConfigMismatch otherwise), and the message expires at valid_until.
async function proposeResume(deps: AdminDeps, adminId: string, status: ProtocolStatus) {
  if (!status.paused) throw new AdminError("the protocol is not paused, so there is nothing to resume", 409);
  const vault = multisigAuthority(deps, status, "resuming");
  const validUntil = await adminMessageValidUntil(deps);
  const instruction = await deps.program.methods
    .pauseProtocol(false, new anchor.BN(validUntil))
    .accountsStrict({ authority: vault, config: pdas(deps.program.programId).config() })
    .instruction();
  return { status, ...(await proposeToMultisig(deps, adminId, instruction, "adspaces: resume protocol", "squads-resume", validUntil)) };
}

// The Squads vault must be the config authority, or the proposal could never execute.
function multisigAuthority(deps: AdminDeps, status: ProtocolStatus, action: string): PublicKey {
  const { squads } = deps;
  if (!squads) throw new AdminError(`${action} needs the multisig; set SQUADS_MULTISIG`, 409);
  if (!squads.vault.equals(status.authority)) {
    throw new AdminError(`the config authority ${status.authority.toBase58()} is not the SQUADS_MULTISIG vault ${squads.vault.toBase58()}`, 409);
  }
  return status.authority;
}

// Opens a Squads proposal for one config-authority instruction; members approve and execute it in the Squads app.
async function proposeToMultisig(
  deps: AdminDeps,
  adminId: string,
  instruction: TransactionInstruction,
  memo: string,
  keyPrefix: string,
  validUntil: number,
) {
  const squads = deps.squads!;
  // Members see the expiry in the Squads app next to the memo.
  const proposal = await squads.propose([instruction], `${memo} (expires ${new Date(validUntil * 1000).toISOString().replace(/\.\d+Z$/, "Z")})`);
  const tx = await deps.runTx({
    op: "squads_proposal",
    idempotencyKey: `${keyPrefix}:${proposal.transactionIndex}:${randomUUID()}`,
    actorId: adminId,
    instructions: proposal.instructions,
    feePayer: deps.authority,
    signers: cosigners(deps.authority, squads.proposer),
  });
  return { signature: tx.signature, pending: squadsPending(proposal, validUntil) };
}

// The program captures the timeout on each dispute when it is raised, so a change only applies to
// disputes raised afterwards. With the multisig as config authority the change becomes a Squads proposal.
export async function setDisputeTimeout(
  deps: AdminDeps,
  adminId: string,
  seconds: number,
): Promise<{ status: ProtocolStatus; signature: string | null; pending?: SquadsPending }> {
  if (!Number.isInteger(seconds) || seconds < MIN_DISPUTE_TIMEOUT_SECONDS || seconds > MAX_DISPUTE_TIMEOUT_SECONDS) {
    throw new AdminError("dispute timeout must be between 1 hour and 30 days");
  }
  const status = await deps.readProtocolStatus();
  if (status.disputeTimeoutSeconds === seconds) return { status, signature: null };
  const config = pdas(deps.program.programId).config();
  // Compare-and-set: the message only applies over the value read now (ConfigMismatch otherwise), so an
  // older approved proposal executed late can't overwrite a newer timeout.
  const expected = new anchor.BN(status.disputeTimeoutSeconds);
  const validUntil = await adminMessageValidUntil(deps);
  if (!status.authority.equals(deps.authority.publicKey)) {
    const vault = multisigAuthority(deps, status, "changing the dispute timeout");
    const instruction = await deps.program.methods
      .setDisputeTimeout(new anchor.BN(seconds), expected, new anchor.BN(validUntil))
      .accountsStrict({ authority: vault, config })
      .instruction();
    return { status, ...(await proposeToMultisig(deps, adminId, instruction, "adspaces: set dispute timeout", "squads-dispute-timeout", validUntil)) };
  }
  const instruction = await deps.program.methods
    .setDisputeTimeout(new anchor.BN(seconds), expected, new anchor.BN(validUntil))
    .accountsStrict({ authority: deps.authority.publicKey, config })
    .instruction();
  const tx = await deps.runTx({
    op: "set_dispute_timeout",
    idempotencyKey: `dispute-timeout:${seconds}:${randomUUID()}`,
    actorId: adminId,
    instructions: [instruction],
    feePayer: deps.authority,
  });
  return { status: await deps.readProtocolStatus(), signature: tx.signature };
}

// Emergency pause by the pause guardian's own wallet, connected in the admin panel. The server builds
// the transaction (the browser has no RPC) and later submits it, but never signs it: the guardian is
// the fee payer and only signer.
export interface GuardianPauseDeps {
  db: Db;
  program: AdspacesProgram;
  readProtocolStatus: () => Promise<ProtocolStatus>;
  prepareTx: (request: Omit<ChainTxRequest, "signers">) => Promise<PreparedChainTx>;
  submitTx: (chainTxId: string, signedBase64: string) => Promise<ChainTxResult>;
}

function guardianPauseInstruction(program: AdspacesProgram, guardian: PublicKey): Promise<TransactionInstruction> {
  const config = pdas(program.programId).config();
  return program.methods
    .guardianPause()
    .accountsStrict({ guardian, config, pauseGuardian: pdas(program.programId).pauseGuardian(config) })
    .instruction();
}

async function activeGuardian(deps: GuardianPauseDeps): Promise<PublicKey> {
  const status = await deps.readProtocolStatus();
  if (status.paused) throw new AdminError("the protocol is already paused", 409);
  if (!status.pauseGuardian) throw new AdminError("no pause guardian is set on-chain; the multisig must set one first", 409);
  return status.pauseGuardian;
}

// Step 1: an unsigned guardian_pause transaction for the connected wallet, which must be the on-chain guardian.
export async function prepareGuardianPause(deps: GuardianPauseDeps, adminId: string, walletInput: string): Promise<PreparedChainTx> {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(walletInput.trim());
  } catch {
    throw new AdminError("that isn't a valid wallet address");
  }
  const guardian = await activeGuardian(deps);
  if (!wallet.equals(guardian)) throw new AdminError(`this wallet is not the pause guardian (${guardian.toBase58()})`, 409);
  return deps.prepareTx({
    op: "pause_protocol",
    idempotencyKey: `guardian-pause:${randomUUID()}`,
    actorId: adminId,
    instructions: [await guardianPauseInstruction(deps.program, guardian)],
    feePayer: externalSigner(guardian),
  });
}

// The signed transaction must be exactly one guardian_pause, paid for and signed by the on-chain guardian alone.
function assertGuardianPause(transaction: Transaction, expected: TransactionInstruction, guardian: PublicKey) {
  const [instruction, ...rest] = transaction.instructions;
  const same =
    instruction &&
    rest.length === 0 &&
    instruction.programId.equals(expected.programId) &&
    instruction.data.equals(expected.data) &&
    instruction.keys.length === expected.keys.length &&
    instruction.keys.every((key, index) => key.pubkey.equals(expected.keys[index].pubkey));
  if (!same) throw new AdminError("the transaction must contain only the guardian pause");
  const [signature, ...others] = transaction.signatures;
  if (!transaction.feePayer?.equals(guardian) || !signature?.publicKey.equals(guardian) || others.length > 0) {
    throw new AdminError("the transaction must be paid for and signed by the pause guardian only");
  }
  if (!signature.signature || !transaction.verifySignatures(true)) throw new AdminError("the transaction is missing the guardian's signature");
}

// Step 2: checks what the guardian signed, then sends it with the server's RPC and waits for confirmation.
// The runner also refuses anything that isn't byte-identical to the prepared transaction.
export async function submitGuardianPause(deps: GuardianPauseDeps, adminId: string, chainTxId: string, signedBase64: string) {
  const [row] = await deps.db
    .select({ id: chainTxs.id, preparedTx: chainTxs.preparedTx })
    .from(chainTxs)
    .where(and(eq(chainTxs.id, chainTxId), eq(chainTxs.op, "pause_protocol"), eq(chainTxs.actorId, adminId)));
  if (!row?.preparedTx) throw new AdminError("pause transaction not found", 404);
  let signed: Transaction;
  try {
    signed = Transaction.from(Buffer.from(signedBase64, "base64"));
  } catch {
    throw new AdminError("the signed transaction could not be read");
  }
  const guardian = await activeGuardian(deps);
  assertGuardianPause(signed, await guardianPauseInstruction(deps.program, guardian), guardian);
  const tx = await deps.submitTx(row.id, signedBase64);
  return { status: await deps.readProtocolStatus(), signature: tx.signature };
}

// ---------- reviewer key rotation: adopt_listing ----------

export interface AdoptListingsDeps {
  db: Db;
  program: AdspacesProgram;
  // The server's reviewer key; it must be the on-chain review authority, signs every adopt_listing and pays the fees.
  reviewer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readReviewAuthority: () => Promise<PublicKey>;
  readListingRentPayers: (listings: PublicKey[]) => Promise<Array<PublicKey | null>>;
}

export interface AdoptListingsReport {
  reviewer: string;
  adopted: Array<{ listingId: string; title: string; previousRentPayer: string; signature: string }>;
  skipped: Array<{ listingId: string; title: string; reason: string }>;
  failed: Array<{ listingId: string; title: string; error: string }>;
}

// adopt_listing is four accounts; this many fit one legacy transaction with room to spare.
export const ADOPT_BATCH_SIZE = 8;

// After the review authority moves to a new reviewer key, live listings still name the former key as
// their rent payer, which keeps its power to close them and co-sign spots, proof and disputes. This
// moves every one of them to the current key (rent of their accounts then returns to it). Idempotent:
// listings already on the current key, or no longer on-chain, are skipped.
export async function adoptListings(deps: AdoptListingsDeps, adminId: string): Promise<AdoptListingsReport> {
  const reviewer = deps.reviewer.publicKey;
  const authority = await deps.readReviewAuthority();
  if (!authority.equals(reviewer)) {
    throw new AdminError(
      `the server's reviewer key ${reviewer.toBase58()} is not the on-chain review authority ${authority.toBase58()}; rotate the review authority to it first`,
      409,
    );
  }
  const live = await deps.db
    .select({ id: listings.id, title: listings.title, chainAddress: listings.chainAddress })
    .from(listings)
    .where(and(isNotNull(listings.chainAddress), ne(listings.state, "closed")))
    .orderBy(asc(listings.createdAt));
  const report: AdoptListingsReport = { reviewer: reviewer.toBase58(), adopted: [], skipped: [], failed: [] };
  const payers = live.length ? await deps.readListingRentPayers(live.map((row) => new PublicKey(row.chainAddress!))) : [];
  const pending: Array<{ id: string; title: string; address: PublicKey; previous: PublicKey }> = [];
  live.forEach((row, index) => {
    const payer = payers[index];
    if (!payer) report.skipped.push({ listingId: row.id, title: row.title, reason: "not on-chain" });
    else if (payer.equals(reviewer)) report.skipped.push({ listingId: row.id, title: row.title, reason: "already on the current key" });
    else pending.push({ id: row.id, title: row.title, address: new PublicKey(row.chainAddress!), previous: payer });
  });

  const addresses = pdas(deps.program.programId);
  const config = addresses.config();
  const reviewAuthority = addresses.reviewAuthority(config);
  for (let start = 0; start < pending.length; start += ADOPT_BATCH_SIZE) {
    const batch = pending.slice(start, start + ADOPT_BATCH_SIZE);
    try {
      const instructions = await Promise.all(
        batch.map((item) =>
          deps.program.methods.adoptListing().accountsStrict({ reviewer, config, reviewAuthority, listing: item.address }).instruction(),
        ),
      );
      const tx = await deps.runTx({
        // No chain_op of its own (that would need a migration); the idempotency key names it.
        op: "publish_listing",
        idempotencyKey: `adopt-listings:${reviewer.toBase58()}:${batch.map((item) => item.id).join(",")}`,
        listingId: batch.length === 1 ? batch[0].id : undefined,
        actorId: adminId,
        instructions,
        feePayer: deps.reviewer,
      });
      for (const item of batch) {
        report.adopted.push({ listingId: item.id, title: item.title, previousRentPayer: item.previous.toBase58(), signature: tx.signature });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const item of batch) report.failed.push({ listingId: item.id, title: item.title, error: message });
    }
  }
  return report;
}
