import { randomUUID } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import type { PublicKey } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { pdas, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";

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
}

export interface AdminDeps {
  db: Db;
  program: AdspacesProgram;
  // Must be the program's config authority.
  authority: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readProtocolStatus: () => Promise<ProtocolStatus>;
}

// Mirrors the program's bounds (production build); devnet allows shorter values on-chain.
export const MIN_DISPUTE_TIMEOUT_SECONDS = 60 * 60;
export const MAX_DISPUTE_TIMEOUT_SECONDS = 30 * 24 * 60 * 60;

function assertAuthority(deps: AdminDeps, status: ProtocolStatus) {
  if (!status.authority.equals(deps.authority.publicKey)) {
    throw new AdminError("the server key is not the program's config authority", 503);
  }
}

export async function setPaused(deps: AdminDeps, adminId: string, paused: boolean) {
  const status = await deps.readProtocolStatus();
  assertAuthority(deps, status);
  if (status.paused === paused) return { status, signature: null };
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

export async function setDisputeTimeout(deps: AdminDeps, adminId: string, seconds: number) {
  if (!Number.isInteger(seconds) || seconds < MIN_DISPUTE_TIMEOUT_SECONDS || seconds > MAX_DISPUTE_TIMEOUT_SECONDS) {
    throw new AdminError("dispute timeout must be between 1 hour and 30 days");
  }
  const status = await deps.readProtocolStatus();
  assertAuthority(deps, status);
  if (status.disputeTimeoutSeconds === seconds) return { status, signature: null };
  const instruction = await deps.program.methods
    .setDisputeTimeout(new anchor.BN(seconds))
    .accountsStrict({ authority: deps.authority.publicKey, config: pdas(deps.program.programId).config() })
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
