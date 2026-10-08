import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { users, withdrawals } from "../db/schema.js";
import { associatedTokenAddress, TOKEN_PROGRAM_ID } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";
import { createAtaIdempotent } from "./settlement.js";

export class WalletError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface WalletDeps {
  db: Db;
  mint: PublicKey;
  feePayer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
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

export async function withdrawUsdc(deps: WalletDeps, userId: string, owner: TxSigner, destinationInput: string, amount: bigint) {
  const now = deps.now?.() ?? new Date();
  if (amount <= 0n) throw new WalletError("enter an amount above zero");
  const destination = parseDestination(destinationInput, owner.publicKey);
  const balance = await deps.readTokenBalance(owner.publicKey);
  if (balance < amount) throw new WalletError("not enough USDC in your wallet", 409);

  const withdrawal = await reserve(deps, userId, amount, destination.toBase58(), now);
  const sourceAta = associatedTokenAddress(owner.publicKey, deps.mint);
  const destinationAta = associatedTokenAddress(destination, deps.mint);
  const instructions: TransactionInstruction[] = [];
  if (!(await deps.accountExists(destinationAta))) {
    instructions.push(createAtaIdempotent(deps.feePayer.publicKey, destination, deps.mint));
  }
  instructions.push(transferChecked(sourceAta, deps.mint, destinationAta, owner.publicKey, amount));

  try {
    const tx = await deps.runTx({
      op: "wallet_withdrawal",
      idempotencyKey: `withdrawal:${withdrawal.id}`,
      actorId: userId,
      instructions,
      feePayer: deps.feePayer,
      signers: [owner],
    });
    const [confirmed] = await deps.db
      .update(withdrawals)
      .set({ state: "confirmed", chainTxId: tx.chainTxId, updatedAt: new Date() })
      .where(eq(withdrawals.id, withdrawal.id))
      .returning();
    return { withdrawal: confirmed, signature: tx.signature };
  } catch (error) {
    // Failed withdrawals release their share of the daily limit.
    await deps.db.update(withdrawals).set({ state: "failed", updatedAt: new Date() }).where(eq(withdrawals.id, withdrawal.id));
    throw error;
  }
}

export async function listWithdrawals(db: Db, userId: string, limit = 50) {
  return db
    .select()
    .from(withdrawals)
    .where(eq(withdrawals.userId, userId))
    .orderBy(desc(withdrawals.createdAt))
    .limit(limit);
}
