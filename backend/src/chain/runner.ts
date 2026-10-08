import { eq, sql } from "drizzle-orm";
import { Connection, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import type { Db } from "../db/client.js";
import { chainTxs } from "../db/schema.js";
import { ChainError, decodeChainError } from "./errors.js";
import type { TxSigner } from "./signers.js";

type ChainOp = (typeof chainTxs.$inferInsert)["op"];

export interface ChainTxRequest {
  op: ChainOp;
  idempotencyKey: string;
  listingId?: string;
  spotId?: string;
  actorId?: string;
  instructions: TransactionInstruction[];
  feePayer: TxSigner;
  // Extra signers, e.g. the user's Privy wallet; they sign before the fee payer.
  signers?: TxSigner[];
}

export interface ChainTxResult {
  chainTxId: string;
  signature: string;
}

// Every on-chain action goes through here:
//   1. record a pending row keyed by idempotency key (duplicate requests reuse it)
//   2. sign, store the signature *before* sending so a crash can be reconciled
//   3. send, confirm, and check the confirmation error
//   4. mark confirmed or failed with a decoded, user-facing message
// Callers apply their DB state transition only after this resolves.
export async function runChainTx(db: Db, connection: Connection, request: ChainTxRequest): Promise<ChainTxResult> {
  const [inserted] = await db
    .insert(chainTxs)
    .values({
      op: request.op,
      idempotencyKey: request.idempotencyKey,
      listingId: request.listingId,
      spotId: request.spotId,
      actorId: request.actorId,
    })
    .onConflictDoNothing({ target: chainTxs.idempotencyKey })
    .returning({ id: chainTxs.id });

  const existing = inserted
    ? undefined
    : await db.query.chainTxs.findFirst({ where: eq(chainTxs.idempotencyKey, request.idempotencyKey) });
  const row = inserted ?? existing;
  if (!row) throw new ChainError("could not record transaction", undefined, undefined, 500);

  if (existing?.status === "confirmed" && existing.signature) {
    return { chainTxId: existing.id, signature: existing.signature };
  }
  if (existing?.status === "submitted" && existing.signature) {
    const settled = await settlePreviousAttempt(db, connection, existing.id, existing.signature, existing.updatedAt);
    if (settled) return settled;
  }

  const latest = await connection.getLatestBlockhash("confirmed");
  let transaction = new Transaction({ feePayer: request.feePayer.publicKey, ...latest }).add(...request.instructions);
  for (const signer of request.signers ?? []) transaction = await signer.sign(transaction);
  transaction = await request.feePayer.sign(transaction);
  if (!transaction.signature) throw new ChainError("transaction was not signed", undefined, undefined, 500);
  const signature = utils.bytes.bs58.encode(transaction.signature);

  await db
    .update(chainTxs)
    .set({ status: "submitted", signature, error: null, attempts: sql`${chainTxs.attempts} + 1`, updatedAt: new Date() })
    .where(eq(chainTxs.id, row.id));

  try {
    await connection.sendRawTransaction(transaction.serialize(), { preflightCommitment: "confirmed" });
    const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (confirmation.value.err) {
      const details = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      throw decodeChainError(confirmation.value.err, details?.meta?.logMessages);
    }
  } catch (error) {
    const decoded =
      error instanceof ChainError ? error : decodeChainError(error, (error as { logs?: string[] }).logs);
    await db
      .update(chainTxs)
      .set({ status: "failed", error: decoded.programError ?? decoded.message, updatedAt: new Date() })
      .where(eq(chainTxs.id, row.id));
    throw decoded;
  }

  await db
    .update(chainTxs)
    .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(chainTxs.id, row.id));
  return { chainTxId: row.id, signature };
}

// Blockhashes stay valid for ~60-90s; past this, an unseen signature can never land.
const BLOCKHASH_EXPIRY_MS = 2 * 60 * 1000;

// A previous attempt was sent but its outcome was never recorded (e.g. process crash).
async function settlePreviousAttempt(
  db: Db,
  connection: Connection,
  chainTxId: string,
  signature: string,
  submittedAt: Date,
): Promise<ChainTxResult | undefined> {
  const { value } = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  if (value && !value.err && (value.confirmationStatus === "confirmed" || value.confirmationStatus === "finalized")) {
    await db
      .update(chainTxs)
      .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(chainTxs.id, chainTxId));
    return { chainTxId, signature };
  }
  if (value?.err) {
    await db
      .update(chainTxs)
      .set({ status: "failed", error: JSON.stringify(value.err), updatedAt: new Date() })
      .where(eq(chainTxs.id, chainTxId));
    return undefined;
  }
  // Unseen but possibly still in flight: resending now could execute the action twice.
  if (Date.now() - submittedAt.getTime() < BLOCKHASH_EXPIRY_MS) {
    throw new ChainError("previous attempt is still confirming; try again in a minute", undefined, undefined, 409);
  }
  return undefined;
}
