import { eventAmount, type TxEventReader } from "../chain/events.js";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { disputeEvidence, disputes, listings, mediaAssets, settlements, spotEvents, spots, users } from "../db/schema.js";
import { calculateDisputeSplit } from "../domain/fees.js";
import { nextSpotState } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import { cosigners, type TxSigner } from "../chain/signers.js";
import { createAtaIdempotent, payoutAvailableAt, type ListingSnapshot } from "./settlement.js";

export class DisputeError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export interface DisputeDeps {
  db: Db;
  program: AdspacesProgram;
  mint: PublicKey;
  feePayer: TxSigner;
  // The listing's on-chain rent payer: pays dispute rent (buyers never need SOL) and gets all rent back.
  rentPayer: TxSigner;
  // Must be the program's config authority: only it can resolve disputes on-chain.
  resolver: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readListingSnapshot: (listing: PublicKey) => Promise<ListingSnapshot>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  accountExists: (address: PublicKey) => Promise<boolean>;
  // Reads the program's event from the confirmed tx; amounts recorded are what actually moved.
  readTxEvent?: TxEventReader;
  readDisputeTimeoutSeconds: () => Promise<number>;
  listingBaseUrl: string;
  now?: () => Date;
}

const URI_MAX_BYTES = 200;
const MAX_EVIDENCE = 6;

async function loadSpot(db: Db, spotId: string) {
  const [row] = await db
    .select({ spot: spots, listing: listings, handle: users.handle })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(spots.id, spotId));
  if (!row) throw new DisputeError("spot not found", 404);
  if (!row.listing.chainAddress || !row.spot.chainAddress || !row.spot.vaultAddress || !row.listing.sellerWallet) {
    throw new DisputeError("spot is not published on-chain");
  }
  return row;
}

async function openDispute(db: Db, spotId: string) {
  const [dispute] = await db.select().from(disputes).where(and(eq(disputes.spotId, spotId), eq(disputes.state, "open")));
  if (!dispute) throw new DisputeError("there's no open dispute on this spot");
  return dispute;
}

function listingUri(base: string, handle: string, slug: string, fragment: string) {
  const uri = `${base.replace(/\/$/, "")}/${encodeURIComponent(handle)}/${encodeURIComponent(slug)}#${fragment}`;
  if (Buffer.byteLength(uri) > URI_MAX_BYTES) throw new DisputeError("link is too long to record on-chain", 500);
  return uri;
}

const sha256 = (value: string) => createHash("sha256").update(value).digest();

// Buyer disputes after the delivery deadline: anytime if no proof arrived,
// or within the review window if the creator submitted proof.
export async function raiseDispute(
  deps: DisputeDeps,
  buyerId: string,
  buyer: TxSigner,
  spotId: string,
  input: { reason: string; evidenceAssetIds?: string[] },
) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing, handle } = await loadSpot(deps.db, spotId);
  if (spot.buyerId !== buyerId) throw new DisputeError("only the sponsor of this spot can dispute it", 403);
  if (spot.buyerWallet !== buyer.publicKey.toBase58()) throw new DisputeError("dispute with the wallet you paid from");
  if (spot.state !== "funded" && spot.state !== "delivered") throw new DisputeError("this spot can't be disputed now");
  if (now < listing.deliveryDueAt) throw new DisputeError("disputes open after the delivery deadline");
  if (spot.state === "delivered" && now >= payoutAvailableAt(listing)) throw new DisputeError("the review window has closed");

  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 2000) throw new DisputeError("explain what went wrong (10-2000 characters)", 400);
  const evidenceIds = [...new Set(input.evidenceAssetIds ?? [])];
  if (evidenceIds.length > MAX_EVIDENCE) throw new DisputeError(`attach at most ${MAX_EVIDENCE} files`, 400);
  const evidence = evidenceIds.length
    ? await deps.db
        .select({ id: mediaAssets.id, url: mediaAssets.url })
        .from(mediaAssets)
        .where(and(inArray(mediaAssets.id, evidenceIds), eq(mediaAssets.ownerId, buyerId), eq(mediaAssets.kind, "evidence")))
    : [];
  if (evidence.length !== evidenceIds.length) throw new DisputeError("one of the evidence files isn't yours", 400);

  const hash = sha256(`adspaces-dispute-v1\n${spot.id}\n${reason}\n${evidence.map((item) => item.url).sort().join("\n")}`);
  const uri = listingUri(deps.listingBaseUrl, handle, listing.slug, `dispute-${spot.index + 1}`);
  const spotKey = new PublicKey(spot.chainAddress!);
  const disputeKey = pdas(deps.program.programId).dispute(spotKey);

  const instruction = await deps.program.methods
    .raiseDispute(Array.from(hash), uri)
    .accountsStrict({
      buyer: buyer.publicKey,
      config: pdas(deps.program.programId).config(),
      // The platform pays the dispute's rent, so buyers never need SOL.
      rentPayer: deps.rentPayer.publicKey,
      listing: new PublicKey(listing.chainAddress!),
      spot: spotKey,
      dispute: disputeKey,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  // A dispute can be withdrawn and raised again, so the key includes the attempt count.
  const previous = await deps.db.select({ id: disputes.id }).from(disputes).where(eq(disputes.spotId, spot.id));
  const tx = await deps.runTx({
    op: "raise_dispute",
    idempotencyKey: `dispute:${spot.id}:${previous.length + 1}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: buyerId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, buyer, deps.rentPayer),
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState(spot.state, "dispute_raised");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, spot.state)))
      .returning();
    if (!updated) throw new DisputeError("spot changed while the dispute was confirming; reconciling", 500);
    const [dispute] = await trx.insert(disputes).values({ spotId: spot.id, buyerId, reason }).returning();
    if (evidence.length) {
      await trx.insert(disputeEvidence).values(evidence.map((item, position) => ({ disputeId: dispute.id, assetId: item.id, position })));
    }
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: spot.state,
      toState: to,
      type: "dispute_raised",
      actorId: buyerId,
      chainTxId: tx.chainTxId,
      data: { disputeId: dispute.id },
    });
    return { spot: updated, dispute, signature: tx.signature };
  });
}

export async function withdrawDispute(deps: DisputeDeps, buyerId: string, buyer: TxSigner, spotId: string) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  const dispute = await openDispute(deps.db, spotId);
  if (dispute.buyerId !== buyerId) throw new DisputeError("only the sponsor can withdraw this dispute", 403);
  const spotKey = new PublicKey(spot.chainAddress!);
  const instruction = await deps.program.methods
    .withdrawDispute()
    .accountsStrict({
      buyer: buyer.publicKey,
      rentPayer: deps.rentPayer.publicKey,
      listing: new PublicKey(listing.chainAddress!),
      spot: spotKey,
      dispute: pdas(deps.program.programId).dispute(spotKey),
    })
    .instruction();
  const tx = await deps.runTx({
    op: "withdraw_dispute",
    idempotencyKey: `withdraw-dispute:${dispute.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: buyerId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: [buyer],
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("disputed", "dispute_withdrawn", { proofSubmitted: Boolean(spot.proofSubmittedAt) });
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "disputed")))
      .returning();
    if (!updated) throw new DisputeError("spot changed while withdrawing; reconciling", 500);
    await trx.update(disputes).set({ state: "withdrawn", closedAt: now }).where(eq(disputes.id, dispute.id));
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "disputed",
      toState: to,
      type: "dispute_withdrawn",
      actorId: buyerId,
      chainTxId: tx.chainTxId,
      data: { disputeId: dispute.id },
    });
    return { spot: updated, signature: tx.signature };
  });
}

// A reviewer splits the escrow; the creator's share pays a proportional platform fee.
export async function resolveDispute(
  deps: DisputeDeps,
  reviewerId: string,
  spotId: string,
  input: { sellerShareBps: number; decision: string },
) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing, handle } = await loadSpot(deps.db, spotId);
  const dispute = await openDispute(deps.db, spotId);
  if (reviewerId === listing.sellerId || reviewerId === dispute.buyerId) {
    throw new DisputeError("you can't resolve a dispute you're part of", 403);
  }
  const { sellerShareBps } = input;
  if (!Number.isInteger(sellerShareBps) || sellerShareBps < 0 || sellerShareBps > 10_000) {
    throw new DisputeError("seller share must be 0-10000 bps", 400);
  }
  const decision = input.decision.trim();
  if (decision.length < 10 || decision.length > 2000) throw new DisputeError("explain the decision (10-2000 characters)", 400);

  const listingKey = new PublicKey(listing.chainAddress!);
  const spotKey = new PublicKey(spot.chainAddress!);
  const vault = new PublicKey(spot.vaultAddress!);
  const seller = new PublicKey(listing.sellerWallet!);
  const buyer = new PublicKey(spot.buyerWallet!);
  const snapshot = await deps.readListingSnapshot(listingKey);
  const balance = await deps.readVaultBalance(vault);
  if (balance <= 0n) throw new DisputeError("vault is empty; reconciling");
  const split = calculateDisputeSplit(snapshot.fees, spot.price, balance, sellerShareBps);

  const addresses = pdas(deps.program.programId);
  const proofKey = addresses.proof(spotKey);
  const instructions: TransactionInstruction[] = [];
  for (const owner of [seller, buyer, snapshot.treasury]) {
    if (!(await deps.accountExists(associatedTokenAddress(owner, deps.mint)))) {
      instructions.push(createAtaIdempotent(deps.feePayer.publicKey, owner, deps.mint));
    }
  }
  instructions.push(
    await deps.program.methods
      .resolveDispute(sellerShareBps, Array.from(sha256(`adspaces-decision-v1\n${dispute.id}\n${sellerShareBps}\n${decision}`)), listingUri(deps.listingBaseUrl, handle, listing.slug, `decision-${spot.index + 1}`))
      .accountsStrict({
        resolver: deps.resolver.publicKey,
        rentPayer: deps.rentPayer.publicKey,
        config: addresses.config(),
        listing: listingKey,
        spot: spotKey,
        dispute: addresses.dispute(spotKey),
        vault,
        sellerAta: associatedTokenAddress(seller, deps.mint),
        seller,
        buyerAta: associatedTokenAddress(buyer, deps.mint),
        treasuryAta: associatedTokenAddress(snapshot.treasury, deps.mint),
        proof: spot.proofSubmittedAt ? proofKey : null,
        usdcMint: deps.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  );
  const tx = await deps.runTx({
    op: "resolve_dispute",
    idempotencyKey: `resolve:${dispute.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: reviewerId,
    instructions,
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, deps.resolver),
  });
  // Tokens can land in the vault between the balance read and the transfer; trust the program's event.
  const resolved = await deps.readTxEvent?.(tx.signature, "DisputeResolved").catch(() => null);
  const moved = resolved
    ? {
        buyerRefund: eventAmount(resolved, "buyerRefund", "buyer_refund"),
        sellerNet: eventAmount(resolved, "sellerAmount", "seller_amount"),
        fee: eventAmount(resolved, "fee", "fee"),
      }
    : null;
  const recorded =
    moved && moved.buyerRefund !== null && moved.sellerNet !== null && moved.fee !== null
      ? { buyerRefund: moved.buyerRefund, sellerNet: moved.sellerNet, fee: moved.fee }
      : { buyerRefund: split.buyerRefund, sellerNet: split.sellerNet, fee: split.fee };

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("disputed", "dispute_resolved");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "disputed")))
      .returning();
    if (!updated) throw new DisputeError("spot changed while resolving; reconciling", 500);
    await trx
      .update(disputes)
      .set({ state: "resolved", sellerShareBps, decision, resolvedBy: reviewerId, closedAt: now })
      .where(eq(disputes.id, dispute.id));
    const [settlement] = await trx
      .insert(settlements)
      .values({
        spotId: spot.id,
        kind: "dispute_split",
        gross: recorded.buyerRefund + recorded.sellerNet + recorded.fee,
        fee: recorded.fee,
        sellerNet: recorded.sellerNet,
        buyerRefund: recorded.buyerRefund,
        chainTxId: tx.chainTxId,
      })
      .returning();
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "disputed",
      toState: to,
      type: "dispute_resolved",
      actorId: reviewerId,
      chainTxId: tx.chainTxId,
      data: { disputeId: dispute.id, sellerShareBps },
    });
    return { spot: updated, settlement, signature: tx.signature };
  });
}

// If reviewers miss the configured window, anyone can refund the buyer in full.
export async function timeoutDispute(deps: DisputeDeps, spotId: string, triggeredBy?: string) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  const dispute = await openDispute(deps.db, spotId);
  const timeoutSeconds = await deps.readDisputeTimeoutSeconds();
  const timesOutAt = new Date(dispute.openedAt.getTime() + timeoutSeconds * 1000);
  if (now < timesOutAt) throw new DisputeError(`auto-refund opens ${timesOutAt.toISOString()}`);

  const listingKey = new PublicKey(listing.chainAddress!);
  const spotKey = new PublicKey(spot.chainAddress!);
  const vault = new PublicKey(spot.vaultAddress!);
  const buyer = new PublicKey(spot.buyerWallet!);
  const balance = await deps.readVaultBalance(vault);
  const addresses = pdas(deps.program.programId);
  const instructions: TransactionInstruction[] = [];
  if (!(await deps.accountExists(associatedTokenAddress(buyer, deps.mint)))) {
    instructions.push(createAtaIdempotent(deps.feePayer.publicKey, buyer, deps.mint));
  }
  instructions.push(
    await deps.program.methods
      .timeoutDispute()
      .accountsStrict({
        caller: deps.feePayer.publicKey,
        rentPayer: deps.rentPayer.publicKey,
        config: addresses.config(),
        listing: listingKey,
        spot: spotKey,
        dispute: addresses.dispute(spotKey),
        proof: spot.proofSubmittedAt ? addresses.proof(spotKey) : null,
        vault,
        buyerAta: associatedTokenAddress(buyer, deps.mint),
        usdcMint: deps.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
  );
  const tx = await deps.runTx({
    op: "timeout_dispute",
    idempotencyKey: `timeout:${dispute.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: triggeredBy,
    instructions,
    feePayer: deps.feePayer,
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("disputed", "dispute_timed_out");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "disputed")))
      .returning();
    if (!updated) throw new DisputeError("spot changed while refunding; reconciling", 500);
    await trx.update(disputes).set({ state: "timed_out", closedAt: now }).where(eq(disputes.id, dispute.id));
    const [settlement] = await trx
      .insert(settlements)
      .values({ spotId: spot.id, kind: "timeout_refund", gross: balance, fee: 0n, sellerNet: 0n, buyerRefund: balance, chainTxId: tx.chainTxId })
      .returning();
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "disputed",
      toState: to,
      type: "dispute_timed_out",
      actorId: triggeredBy,
      chainTxId: tx.chainTxId,
      data: { disputeId: dispute.id },
    });
    return { spot: updated, settlement, signature: tx.signature };
  });
}
