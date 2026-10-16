import { eventAmount, type TxEventReader } from "../chain/events.js";
import { createHash } from "node:crypto";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { chainTxs, disputeEvidence, disputes, listings, mediaAssets, settlements, spotEvents, spots, users } from "../db/schema.js";
import { calculateDisputeSplit } from "../domain/fees.js";
import { nextSpotState } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import { cosigners, type TxSigner } from "../chain/signers.js";
import { squadsPending, type SquadsProposer } from "../chain/squads.js";
import type { ChainSpotStatus } from "./reconciler.js";
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
  // Resolves directly when it is the program's config authority (only that key can resolve on-chain).
  resolver: TxSigner;
  // The on-chain config authority; assumed to be `resolver` when not given.
  readConfigAuthority?: () => Promise<PublicKey>;
  // When the config authority is this multisig's vault, decisions become Squads proposals instead.
  squads?: SquadsProposer;
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

// Proposals that still count: anything not rejected, cancelled or gone blocks a second one.
const LIVE_PROPOSAL = new Set(["draft", "active", "approved", "executing", "executed"]);

const decisionHash = (disputeId: string, sellerShareBps: number, decision: string) =>
  sha256(`adspaces-decision-v1\n${disputeId}\n${sellerShareBps}\n${decision}`);

type Recorded = { buyerRefund: bigint; sellerNet: bigint; fee: bigint };

// Amounts the program reported in DisputeResolved, or null when the event is missing or incomplete.
function resolvedAmounts(event: Record<string, unknown> | null | undefined): Recorded | null {
  if (!event) return null;
  const buyerRefund = eventAmount(event, "buyerRefund", "buyer_refund");
  const sellerNet = eventAmount(event, "sellerAmount", "seller_amount");
  const fee = eventAmount(event, "fee", "fee");
  return buyerRefund !== null && sellerNet !== null && fee !== null ? { buyerRefund, sellerNet, fee } : null;
}

// The DB side of a confirmed resolve_dispute, shared by the direct path and the Squads reconciler.
async function recordResolution(
  db: Db,
  input: {
    spotId: string;
    disputeId: string;
    sellerShareBps: number;
    decision: string;
    resolvedBy: string;
    // The confirmed transaction, or a writer that records it in the same database transaction.
    chainTx: string | ((trx: Db) => Promise<string>);
    recorded: Recorded;
    now: Date;
  },
) {
  const { spotId, disputeId, sellerShareBps, decision, resolvedBy, recorded, now } = input;
  return db.transaction(async (trx) => {
    const chainTxId = typeof input.chainTx === "string" ? input.chainTx : await input.chainTx(trx as unknown as Db);
    const to = nextSpotState("disputed", "dispute_resolved");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, updatedAt: now })
      .where(and(eq(spots.id, spotId), eq(spots.state, "disputed")))
      .returning();
    if (!updated) throw new DisputeError("spot changed while resolving; reconciling", 500);
    await trx
      .update(disputes)
      .set({ state: "resolved", sellerShareBps, decision, resolvedBy, closedAt: now })
      .where(eq(disputes.id, disputeId));
    const [settlement] = await trx
      .insert(settlements)
      .values({
        spotId,
        kind: "dispute_split",
        gross: recorded.buyerRefund + recorded.sellerNet + recorded.fee,
        fee: recorded.fee,
        sellerNet: recorded.sellerNet,
        buyerRefund: recorded.buyerRefund,
        chainTxId,
      })
      .returning();
    await trx.insert(spotEvents).values({
      spotId,
      fromState: "disputed",
      toState: to,
      type: "dispute_resolved",
      actorId: resolvedBy,
      chainTxId,
      data: { disputeId, sellerShareBps },
    });
    return { spot: updated, settlement };
  });
}

// A reviewer splits the escrow; the creator's share pays a proportional platform fee.
// When the config authority is the Squads vault, the decision becomes a multisig proposal and the
// dispute stays open until the reconciler sees it executed on-chain.
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

  if (dispute.squadsTransactionIndex !== null) {
    const status = deps.squads ? await deps.squads.proposalStatus(BigInt(dispute.squadsTransactionIndex)) : "active";
    if (status && LIVE_PROPOSAL.has(status)) {
      throw new DisputeError(`already waiting for multisig approval (Squads #${dispute.squadsTransactionIndex})`);
    }
  }
  const authority = deps.readConfigAuthority ? await deps.readConfigAuthority() : deps.resolver.publicKey;
  const direct = authority.equals(deps.resolver.publicKey);
  const squads = direct ? undefined : deps.squads;
  if (!direct && !squads) throw new DisputeError("dispute resolution needs the multisig; set SQUADS_MULTISIG");
  if (squads && !squads.vault.equals(authority)) {
    throw new DisputeError(`the config authority ${authority.toBase58()} is not the SQUADS_MULTISIG vault ${squads.vault.toBase58()}`);
  }

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
  const atas: TransactionInstruction[] = [];
  for (const owner of [seller, buyer, snapshot.treasury]) {
    if (!(await deps.accountExists(associatedTokenAddress(owner, deps.mint)))) {
      atas.push(createAtaIdempotent(deps.feePayer.publicKey, owner, deps.mint));
    }
  }
  const hash = decisionHash(dispute.id, sellerShareBps, decision);
  const uri = listingUri(deps.listingBaseUrl, handle, listing.slug, `decision-${spot.index + 1}`);
  const resolveInstruction = await deps.program.methods
    .resolveDispute(sellerShareBps, Array.from(hash), uri)
    .accountsStrict({
      resolver: authority,
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
    .instruction();

  if (squads) {
    // Token accounts are created by the platform now: the vault transaction carries only the decision.
    if (atas.length) {
      await deps.runTx({
        op: "squads_proposal",
        idempotencyKey: `squads-resolve-atas:${dispute.id}`,
        listingId: listing.id,
        spotId: spot.id,
        actorId: reviewerId,
        instructions: atas,
        feePayer: deps.feePayer,
      });
    }
    const proposal = await squads.propose([resolveInstruction], "adspaces: resolve dispute");
    const tx = await deps.runTx({
      op: "squads_proposal",
      // Per index: a retry after another proposal took this index builds a fresh one.
      idempotencyKey: `squads-resolve:${dispute.id}:${proposal.transactionIndex}`,
      listingId: listing.id,
      spotId: spot.id,
      actorId: reviewerId,
      instructions: proposal.instructions,
      feePayer: deps.feePayer,
      signers: cosigners(deps.feePayer, squads.proposer),
    });
    const pending = squadsPending(proposal);
    const [updated] = await deps.db
      .update(disputes)
      .set({
        squadsMultisig: pending.multisig,
        squadsTransactionIndex: pending.transactionIndex,
        squadsVaultTransaction: pending.vaultTransaction,
        squadsProposal: pending.proposal,
        proposedSellerShareBps: sellerShareBps,
        proposedDecision: decision,
        decisionHash: hash.toString("hex"),
        decisionUri: uri,
        proposedBy: reviewerId,
        proposedAt: now,
      })
      .where(and(eq(disputes.id, dispute.id), eq(disputes.state, "open")))
      .returning();
    if (!updated) throw new DisputeError("dispute changed while proposing; reconciling", 500);
    return { spot, dispute: updated, pending, signature: tx.signature };
  }

  const tx = await deps.runTx({
    op: "resolve_dispute",
    idempotencyKey: `resolve:${dispute.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: reviewerId,
    instructions: [...atas, resolveInstruction],
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, deps.resolver),
  });
  // Tokens can land in the vault between the balance read and the transfer; trust the program's event.
  const resolved = await deps.readTxEvent?.(tx.signature, "DisputeResolved").catch(() => null);
  const recorded = resolvedAmounts(resolved) ?? { buyerRefund: split.buyerRefund, sellerNet: split.sellerNet, fee: split.fee };
  const result = await recordResolution(deps.db, {
    spotId: spot.id,
    disputeId: dispute.id,
    sellerShareBps,
    decision,
    resolvedBy: reviewerId,
    chainTx: tx.chainTxId,
    recorded,
    now,
  });
  return { ...result, signature: tx.signature };
}

export interface DisputeResolution {
  signature: string;
  event: Record<string, unknown>;
}

export interface SquadsSettleDeps {
  db: Db;
  readSpotStatus: (address: string) => Promise<ChainSpotStatus>;
  // The confirmed transaction that resolved this spot's dispute with this decision hash (hex), if any.
  findDisputeResolution: (spotAddress: string, decisionHash: string) => Promise<DisputeResolution | null>;
  now?: () => Date;
}

// Disputes proposed to the multisig stay open until the vault transaction executes. Once the chain
// shows the spot closed by our decision, write the settlement exactly as a direct resolve does.
export async function settleSquadsResolutions(deps: SquadsSettleDeps): Promise<number> {
  const now = deps.now?.() ?? new Date();
  const rows = await deps.db
    .select({ dispute: disputes, chainAddress: spots.chainAddress, spotState: spots.state })
    .from(disputes)
    .innerJoin(spots, eq(spots.id, disputes.spotId))
    .where(and(eq(disputes.state, "open"), isNotNull(disputes.squadsTransactionIndex), isNotNull(spots.chainAddress)));
  let settled = 0;
  for (const { dispute, chainAddress, spotState } of rows) {
    if (spotState !== "disputed") continue;
    if ((await deps.readSpotStatus(chainAddress!)) === "disputed") continue;
    const resolution = await deps.findDisputeResolution(chainAddress!, dispute.decisionHash!);
    const recorded = resolvedAmounts(resolution?.event);
    // Closed some other way (timeout, withdrawal) or unreadable: left to drift detection.
    if (!resolution || !recorded) continue;
    const share = eventAmount(resolution.event, "sellerShareBps", "seller_share_bps");
    try {
      await recordResolution(deps.db, {
        spotId: dispute.spotId,
        disputeId: dispute.id,
        sellerShareBps: share === null ? dispute.proposedSellerShareBps! : Number(share),
        decision: dispute.proposedDecision!,
        resolvedBy: dispute.proposedBy!,
        recorded,
        now,
        // A multisig member sent the executing transaction; record it like one of ours.
        chainTx: async (trx) => {
          await trx
            .insert(chainTxs)
            .values({
              op: "resolve_dispute",
              idempotencyKey: `squads-resolve-executed:${dispute.id}`,
              spotId: dispute.spotId,
              actorId: dispute.proposedBy,
              status: "confirmed",
              signature: resolution.signature,
              confirmedAt: now,
            })
            .onConflictDoNothing();
          const [row] = await trx.select({ id: chainTxs.id }).from(chainTxs).where(eq(chainTxs.signature, resolution.signature));
          if (!row) throw new DisputeError("could not record the multisig's transaction", 500);
          return row.id;
        },
      });
      settled += 1;
    } catch (error) {
      // One bad row must not stop the others; drift detection keeps reporting it.
      console.error(`squads settlement for dispute ${dispute.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return settled;
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
