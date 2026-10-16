import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { chainTxs, users, withdrawals } from "../db/schema.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult, PreparedChainTx } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";
import { createAtaIdempotent } from "./settlement.js";

export class WalletError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

// Withdrawals are signed by the user in the browser (Privy enforces their two-factor there); the
// server only prepares the exact transaction, pays the fee, and submits what the user signed.
export interface WalletDeps {
  db: Db;
  mint: PublicKey;
  feePayer: TxSigner;
  prepareTx: (request: Omit<ChainTxRequest, "signers">) => Promise<PreparedChainTx>;
  submitTx: (chainTxId: string, signedBase64: string) => Promise<ChainTxResult>;
  readTokenBalance: (owner: PublicKey) => Promise<bigint>;
  accountExists: (address: PublicKey) => Promise<boolean>;
  dailyLimit: bigint;
  now?: () => Date;
}

const USDC_DECIMALS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

function transferChecked(source: PublicKey, mint: PublicKey, destination: PublicKey, owner: PublicKey, amount: bigint) {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(amount, 1);
  data.writeUInt8(USDC_DECIMALS, 9);
  return new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  });
}

function parseDestination(value: string, source: PublicKey): PublicKey {
  let destination: PublicKey;
  try {
    destination = new PublicKey(value.trim());
  } catch {
    throw new WalletError("that isn't a valid Solana address");
  }
  // Program-derived addresses can't own a normal token account we create for them.
  if (!PublicKey.isOnCurve(destination.toBytes())) throw new WalletError("send to a regular wallet address");
  if (destination.equals(source)) throw new WalletError("that's your own adspaces wallet");
  return destination;
}

// Reserves the amount under a row lock so parallel requests can't exceed the daily limit.
async function reserve(deps: WalletDeps, userId: string, amount: bigint, destination: string, now: Date) {
  return deps.db.transaction(async (trx) => {
    await trx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    const [{ used }] = await trx
      .select({ used: sql<string>`coalesce(sum(${withdrawals.amount}), 0)` })
      .from(withdrawals)
      .where(
        and(
          eq(withdrawals.userId, userId),
          gte(withdrawals.createdAt, new Date(now.getTime() - DAY_MS)),
          inArray(withdrawals.state, ["pending", "submitted", "confirmed"]),
        ),
      );
    if (BigInt(used) + amount > deps.dailyLimit) {
      throw new WalletError(`daily withdrawal limit is ${deps.dailyLimit / 1_000_000n} USDC`, 429);
    }
    const [row] = await trx.insert(withdrawals).values({ userId, amount, destination, createdAt: now, updatedAt: now }).returning();
    return row;
  });
}

const failWithdrawal = (db: Db, id: string) =>
  db.update(withdrawals).set({ state: "failed", updatedAt: new Date() }).where(eq(withdrawals.id, id));

// Step 1: validate, reserve the amount against the daily limit, and hand back a fee-payer-signed
// transaction for the user's wallet to sign.
export async function prepareWithdrawal(deps: WalletDeps, userId: string, owner: PublicKey, destinationInput: string, amount: bigint) {
  const now = deps.now?.() ?? new Date();
  if (amount <= 0n) throw new WalletError("enter an amount above zero");
  const destination = parseDestination(destinationInput, owner);
  const balance = await deps.readTokenBalance(owner);
  if (balance < amount) throw new WalletError("not enough USDC in your wallet", 409);

  const withdrawal = await reserve(deps, userId, amount, destination.toBase58(), now);
  const sourceAta = associatedTokenAddress(owner, deps.mint);
  const destinationAta = associatedTokenAddress(destination, deps.mint);
  const instructions: TransactionInstruction[] = [];
  if (!(await deps.accountExists(destinationAta))) {
    instructions.push(createAtaIdempotent(deps.feePayer.publicKey, destination, deps.mint));
  }
  instructions.push(transferChecked(sourceAta, deps.mint, destinationAta, owner, amount));

  try {
    const prepared = await deps.prepareTx({
      op: "wallet_withdrawal",
      idempotencyKey: `withdrawal:${withdrawal.id}`,
      actorId: userId,
      instructions,
      feePayer: deps.feePayer,
    });
    await deps.db.update(withdrawals).set({ chainTxId: prepared.chainTxId, updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
    return { withdrawalId: withdrawal.id, transaction: prepared.transaction };
  } catch (error) {
    // Failed withdrawals release their share of the daily limit.
    await failWithdrawal(deps.db, withdrawal.id);
    throw error;
  }
}

// Step 2: submit the transaction the user signed. Only the withdrawal's owner can submit it, and the
// runner rejects anything that isn't byte-identical to what was prepared.
export async function submitWithdrawal(deps: WalletDeps, userId: string, withdrawalId: string, signedBase64: string) {
  const [withdrawal] = await deps.db
    .select()
    .from(withdrawals)
    .where(and(eq(withdrawals.id, withdrawalId), eq(withdrawals.userId, userId)));
  if (!withdrawal?.chainTxId) throw new WalletError("withdrawal not found", 404);
  if (withdrawal.state !== "pending") throw new WalletError("this withdrawal is no longer waiting for a signature", 409);
  try {
    const tx = await deps.submitTx(withdrawal.chainTxId, signedBase64);
    const [confirmed] = await deps.db
      .update(withdrawals)
      .set({ state: "confirmed", updatedAt: new Date() })
      .where(eq(withdrawals.id, withdrawal.id))
      .returning();
    return { withdrawal: confirmed, signature: tx.signature };
  } catch (error) {
    // Follow the transaction: failed ends the withdrawal; sent but unconfirmed (RPC or confirmation
    // timeout) stays submitted, still counting toward the daily limit, until the reconciler settles it;
    // never sent (bad upload, RPC down before sending) stays pending so the user can retry.
    const [tx] = await deps.db.select({ status: chainTxs.status }).from(chainTxs).where(eq(chainTxs.id, withdrawal.chainTxId));
    if (tx?.status === "failed") await failWithdrawal(deps.db, withdrawal.id);
    else if (tx?.status === "submitted" || tx?.status === "confirmed") {
      await deps.db.update(withdrawals).set({ state: tx.status, updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
    }
    throw error;
  }
}

// Withdrawals prepared but never signed release their reserved amount once the transaction can no longer land.
export async function expireUnsignedWithdrawals(db: Db, now = new Date(), maxAgeMs = 5 * 60 * 1000) {
  const stale = await db
    .select({ id: withdrawals.id, chainTxId: withdrawals.chainTxId })
    .from(withdrawals)
    .innerJoin(chainTxs, eq(chainTxs.id, withdrawals.chainTxId))
    .where(and(eq(withdrawals.state, "pending"), eq(chainTxs.status, "pending"), sql`${withdrawals.createdAt} < ${new Date(now.getTime() - maxAgeMs)}`));
  for (const row of stale) {
    await failWithdrawal(db, row.id);
    await db.update(chainTxs).set({ status: "failed", error: "never signed", updatedAt: new Date() }).where(eq(chainTxs.id, row.chainTxId!));
  }
  return stale.length;
}

// Includes the Solana signature (from the chain tx log) so the UI can link to the explorer.
// `before` pages back: only withdrawals created before that time.
export async function listWithdrawals(db: Db, userId: string, limit = 50, before?: Date) {
  const rows = await db
    .select({ withdrawal: withdrawals, signature: chainTxs.signature })
    .from(withdrawals)
    .leftJoin(chainTxs, eq(chainTxs.id, withdrawals.chainTxId))
    .where(and(eq(withdrawals.userId, userId), before ? lt(withdrawals.createdAt, before) : undefined))
    .orderBy(desc(withdrawals.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row.withdrawal, signature: row.signature }));
}
