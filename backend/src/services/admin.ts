import { randomUUID } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { and, eq } from "drizzle-orm";
import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { chainTxs } from "../db/schema.js";
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
  if (status.paused === paused) return { status, signature: null };
  if (!status.authority.equals(deps.authority.publicKey)) {
    // The multisig can pause too, but an emergency shouldn't wait for 2 of 3: that's the guardian's job.
    if (paused) {
      const guardian = status.pauseGuardian ? ` (${status.pauseGuardian.toBase58()})` : "";
      throw new AdminError(`the config authority is the multisig, so the server can't pause; the pause guardian${guardian} can, with emergency pause`, 409);
    }
    return proposeResume(deps, adminId, status);
  }
  const instruction = await deps.program.methods
    .pauseProtocol(paused)
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
async function proposeResume(deps: AdminDeps, adminId: string, status: ProtocolStatus) {
  const vault = multisigAuthority(deps, status, "resuming");
  const instruction = await deps.program.methods
    .pauseProtocol(false)
    .accountsStrict({ authority: vault, config: pdas(deps.program.programId).config() })
    .instruction();
  return { status, ...(await proposeToMultisig(deps, adminId, instruction, "adspaces: resume protocol", "squads-resume")) };
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
async function proposeToMultisig(deps: AdminDeps, adminId: string, instruction: TransactionInstruction, memo: string, keyPrefix: string) {
  const squads = deps.squads!;
  const proposal = await squads.propose([instruction], memo);
  const tx = await deps.runTx({
    op: "squads_proposal",
    idempotencyKey: `${keyPrefix}:${proposal.transactionIndex}:${randomUUID()}`,
    actorId: adminId,
    instructions: proposal.instructions,
    feePayer: deps.authority,
    signers: cosigners(deps.authority, squads.proposer),
  });
  return { signature: tx.signature, pending: squadsPending(proposal) };
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
  if (!status.authority.equals(deps.authority.publicKey)) {
    const vault = multisigAuthority(deps, status, "changing the dispute timeout");
    const instruction = await deps.program.methods.setDisputeTimeout(new anchor.BN(seconds)).accountsStrict({ authority: vault, config }).instruction();
    return { status, ...(await proposeToMultisig(deps, adminId, instruction, "adspaces: set dispute timeout", "squads-dispute-timeout")) };
  }
  const instruction = await deps.program.methods
    .setDisputeTimeout(new anchor.BN(seconds))
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
