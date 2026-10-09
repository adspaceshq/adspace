import { and, eq } from "drizzle-orm";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { listings, settlements, spotEvents, spots } from "../db/schema.js";
import { calculateFee, type FeeSnapshot } from "../domain/fees.js";
import { nextSpotState } from "../domain/spot-state.js";
import { ATA_PROGRAM_ID, associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";

export class SettlementError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// On-chain values snapshotted at publish time; payouts must use these, not current config.
export interface ListingSnapshot {
  treasury: PublicKey;
  fees: FeeSnapshot;
}

export interface SettlementDeps {
  db: Db;
  program: AdspacesProgram;
  mint: PublicKey;
  caller: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readListingSnapshot: (listing: PublicKey) => Promise<ListingSnapshot>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  accountExists: (address: PublicKey) => Promise<boolean>;
  now?: () => Date;
}

export function createAtaIdempotent(payer: PublicKey, owner: PublicKey, mint: PublicKey): TransactionInstruction {
  return new TransactionInstruction({
    programId: ATA_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export function payoutAvailableAt(listing: { deliveryDueAt: Date; reviewWindowSeconds: number }): Date {
  return new Date(listing.deliveryDueAt.getTime() + listing.reviewWindowSeconds * 1000);
}

// Pays the creator after the buyer review window closes. Anyone may trigger it, as on-chain.
export async function payoutSeller(deps: SettlementDeps, spotId: string, triggeredBy?: string) {
  const now = deps.now?.() ?? new Date();
  const [row] = await deps.db
    .select({ spot: spots, listing: listings })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.id, spotId));
  if (!row) throw new SettlementError("spot not found", 404);
  const { spot, listing } = row;
  if (spot.state !== "delivered") throw new SettlementError("only delivered spots can be paid out");
  const availableAt = payoutAvailableAt(listing);
  if (now < availableAt) throw new SettlementError(`payout opens ${availableAt.toISOString()}`);
  if (!listing.chainAddress || !spot.chainAddress || !spot.vaultAddress || !listing.sellerWallet) {
    throw new SettlementError("spot is not published on-chain");
  }

  const listingKey = new PublicKey(listing.chainAddress);
  const spotKey = new PublicKey(spot.chainAddress);
  const vault = new PublicKey(spot.vaultAddress);
  const seller = new PublicKey(listing.sellerWallet);
  const snapshot = await deps.readListingSnapshot(listingKey);
  const balance = await deps.readVaultBalance(vault);
  if (balance <= 0n) throw new SettlementError("vault is empty; reconciling");
  const fee = calculateFee(snapshot.fees, spot.price, balance);

  const instructions: TransactionInstruction[] = [];
  for (const owner of [seller, snapshot.treasury]) {
    if (!(await deps.accountExists(associatedTokenAddress(owner, deps.mint)))) {
      instructions.push(createAtaIdempotent(deps.caller.publicKey, owner, deps.mint));
    }
  }
  instructions.push(
    await deps.program.methods
      .withdrawSeller()
      .accountsStrict({
        caller: deps.caller.publicKey,
        listing: listingKey,
        seller,
        spot: spotKey,
        vault,
        sellerAta: associatedTokenAddress(seller, deps.mint),
        treasuryAta: associatedTokenAddress(snapshot.treasury, deps.mint),
        proof: pdas(deps.program.programId).proof(spotKey),
        usdcMint: deps.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  );

  const tx = await deps.runTx({
    op: "withdraw_seller",
    idempotencyKey: `payout:${spot.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: triggeredBy,
    instructions,
    feePayer: deps.caller,
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("delivered", "seller_paid");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "delivered")))
      .returning();
    if (!updated) throw new SettlementError("spot changed while payout was confirming; reconciling", 500);
    const [settlement] = await trx
      .insert(settlements)
      .values({
        spotId: spot.id,
        kind: "payout",
        gross: balance,
        fee,
        sellerNet: balance - fee,
        buyerRefund: 0n,
        chainTxId: tx.chainTxId,
      })
      .returning();
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "delivered",
      toState: to,
      type: "seller_paid",
      actorId: triggeredBy,
      chainTxId: tx.chainTxId,
      data: { gross: balance.toString(), fee: fee.toString() },
    });
    return { spot: updated, settlement, signature: tx.signature };
  });
}
