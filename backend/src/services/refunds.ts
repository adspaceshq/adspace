import { and, asc, eq, inArray } from "drizzle-orm";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { listings, settlements, spotEvents, spots } from "../db/schema.js";
import { nextSpotState, terminalSpotStates } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";
import { createAtaIdempotent } from "./settlement.js";

export class RefundError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export interface RefundDeps {
  db: Db;
  program: AdspacesProgram;
  mint: PublicKey;
  feePayer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  accountExists: (address: PublicKey) => Promise<boolean>;
  now?: () => Date;
}

async function loadSpot(db: Db, spotId: string) {
  const [row] = await db
    .select({ spot: spots, listing: listings })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.id, spotId));
  if (!row) throw new RefundError("spot not found", 404);
  if (!row.listing.chainAddress || !row.spot.chainAddress || !row.spot.vaultAddress || !row.listing.sellerWallet) {
    throw new RefundError("spot is not published on-chain");
  }
  return row;
}

// Two on-chain paths: the creator can refund a funded spot at any time (signing themselves),
// and anyone can refund once the delivery deadline passes with no proof.
export async function refundSpot(
  deps: RefundDeps,
  spotId: string,
  actor: { id?: string; sellerSigner?: TxSigner },
) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  const sellerInitiated = actor.id !== undefined && actor.id === listing.sellerId;
  if (sellerInitiated) {
    if (spot.state !== "funded" && spot.state !== "delivered") throw new RefundError("only paid spots can be refunded");
    if (!actor.sellerSigner || actor.sellerSigner.publicKey.toBase58() !== listing.sellerWallet) {
      throw new RefundError("refund with your listing wallet");
    }
  } else {
    if (spot.state !== "funded") throw new RefundError("this spot can't be refunded by the sponsor");
    if (now < listing.deliveryDueAt) throw new RefundError("refunds open if the creator misses the delivery deadline");
  }

  const vault = new PublicKey(spot.vaultAddress!);
  const buyer = new PublicKey(spot.buyerWallet!);
  const balance = await deps.readVaultBalance(vault);
  const instructions: TransactionInstruction[] = [];
  if (!(await deps.accountExists(associatedTokenAddress(buyer, deps.mint)))) {
    instructions.push(createAtaIdempotent(deps.feePayer.publicKey, buyer, deps.mint));
  }
  const caller = sellerInitiated ? actor.sellerSigner! : deps.feePayer;
  instructions.push(
    await deps.program.methods
      .refundSpot()
      .accountsStrict({
        caller: caller.publicKey,
        listing: new PublicKey(listing.chainAddress!),
        seller: new PublicKey(listing.sellerWallet!),
        spot: new PublicKey(spot.chainAddress!),
        vault,
        buyerAta: associatedTokenAddress(buyer, deps.mint),
        usdcMint: deps.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  );
  const tx = await deps.runTx({
    op: "refund_spot",
    idempotencyKey: `refund:${spot.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: actor.id,
    instructions,
    feePayer: deps.feePayer,
    signers: sellerInitiated ? [actor.sellerSigner!] : [],
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState(spot.state, "refunded");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, spot.state)))
      .returning();
    if (!updated) throw new RefundError("spot changed while refunding; reconciling", 500);
    const [settlement] = await trx
      .insert(settlements)
      .values({ spotId: spot.id, kind: "refund", gross: balance, fee: 0n, sellerNet: 0n, buyerRefund: balance, chainTxId: tx.chainTxId })
      .returning();
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: spot.state,
      toState: to,
      type: "refunded",
      actorId: actor.id,
      chainTxId: tx.chainTxId,
      data: { sellerInitiated, amount: balance.toString() },
    });
    return { spot: updated, settlement, signature: tx.signature };
  });
}

// Withdraws an unsold spot from sale and returns its rent to the creator.
export async function closeSpot(deps: RefundDeps, sellerId: string, seller: TxSigner, spotId: string) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  if (listing.sellerId !== sellerId) throw new RefundError("only the creator can close a spot", 403);
  if (spot.state !== "open") throw new RefundError("only unsold spots can be closed");
  if (seller.publicKey.toBase58() !== listing.sellerWallet) throw new RefundError("close with your listing wallet");
  const instruction = await deps.program.methods
    .closeSpot()
    .accountsStrict({
      seller: seller.publicKey,
      listing: new PublicKey(listing.chainAddress!),
      spot: new PublicKey(spot.chainAddress!),
      vault: new PublicKey(spot.vaultAddress!),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const tx = await deps.runTx({
    op: "close_spot",
    idempotencyKey: `close-spot:${spot.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: sellerId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: [seller],
  });
  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("open", "closed");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "open")))
      .returning();
    if (!updated) throw new RefundError("spot changed while closing; reconciling", 500);
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "open",
      toState: to,
      type: "closed",
      actorId: sellerId,
      chainTxId: tx.chainTxId,
    });
    return { spot: updated, signature: tx.signature };
  });
}

// The program requires every spot account to be closed; settled, refunded and cancelled spots are.
export async function closeListing(deps: RefundDeps, sellerId: string, seller: TxSigner, listingId: string) {
  const now = deps.now?.() ?? new Date();
  const [listing] = await deps.db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new RefundError("listing not found", 404);
  if (listing.sellerId !== sellerId) throw new RefundError("only the creator can close this listing", 403);
  if (listing.state !== "published") throw new RefundError("only live listings can be closed");
  if (now < listing.deadline) throw new RefundError("close the listing after its deadline");
  if (!listing.chainAddress || seller.publicKey.toBase58() !== listing.sellerWallet) {
    throw new RefundError("close with your listing wallet");
  }
  const listingSpots = await deps.db.select().from(spots).where(eq(spots.listingId, listing.id)).orderBy(asc(spots.index));
  const active = listingSpots.filter((spot) => !terminalSpotStates.has(spot.state));
  if (active.length > 0) {
    throw new RefundError(`finish or close ${active.length} remaining spot${active.length === 1 ? "" : "s"} first`);
  }
  const listingKey = new PublicKey(listing.chainAddress);
  const addresses = pdas(deps.program.programId);
  const instruction = await deps.program.methods
    .closeListing()
    .accountsStrict({ seller: seller.publicKey, listing: listingKey })
    .remainingAccounts(
      listingSpots.map((spot) => ({ pubkey: addresses.spot(listingKey, spot.index), isSigner: false, isWritable: false })),
    )
    .instruction();
  const tx = await deps.runTx({
    op: "close_listing",
    idempotencyKey: `close-listing:${listing.id}`,
    listingId: listing.id,
    actorId: sellerId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: [seller],
  });
  const [closed] = await deps.db
    .update(listings)
    .set({ state: "closed", closedAt: now, updatedAt: now })
    .where(and(eq(listings.id, listing.id), inArray(listings.state, ["published"])))
    .returning();
  if (!closed) throw new RefundError("listing changed while closing; reconciling", 500);
  return { listing: closed, signature: tx.signature };
}
