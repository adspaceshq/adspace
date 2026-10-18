import { eventAmount, eventString, type TxEventReader } from "../chain/events.js";
import { createHash } from "node:crypto";
import anchor from "@coral-xyz/anchor";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { PublicKey, SystemProgram, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { chainTxs, disputeEvidence, disputes, listings, mediaAssets, settlements, spotEvents, spots, users } from "../db/schema.js";
import { calculateDisputeSplit, disputeLegs } from "../domain/fees.js";
import { nextSpotState } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import { ChainError } from "../chain/errors.js";
import { cosigners, type TxSigner } from "../chain/signers.js";
import { MAX_TRANSACTION_BYTES, squadsPending, squadsProposalSize, type SquadsProposer } from "../chain/squads.js";
import type { ChainSpotStatus } from "./reconciler.js";
import { createAtaIdempotent, payoutAvailableAt, type ListingSnapshot } from "./settlement.js";

const { BN } = anchor;

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
  // The spot's on-chain DisputeRecord: who paid its rent (and gets it back) and when it times out.
  // Null when there is no record. Without a reader, the payer recorded at raise and the config timeout are used.
  readDisputeRecord?: (spot: PublicKey) => Promise<ChainDisputeRecord | null>;
  // Fallback when the platform can't co-sign a dispute: the buyer's wallet pays the rent and fee itself.
  // The program allows that only once proof exists. Off unless enabled (BUYER_PAID_DISPUTES).
  buyerPaidDisputes?: boolean;
  // Lamports per account, null when missing; checks the buyer can cover the dispute rent first.
  readLamports?: (addresses: PublicKey[]) => Promise<Array<number | null>>;
  listingBaseUrl: string;
  now?: () => Date;
  // Waits before a withdrawal in the dispute's opening seconds; a real timer when not given.
  sleep?: (ms: number) => Promise<void>;
}

export interface ChainDisputeRecord {
  rentPayer: PublicKey;
  timesOutAt: Date;
  // opened_at (unix seconds) and evidence_hash as stored on-chain. resolve_dispute must pass both back
  // (DisputeMismatch otherwise), which binds a decision to this dispute instance and not a re-raised one.
  openedAt?: number;
  evidenceHash?: number[];
}

// Rent for a DisputeRecord (8 + 628 bytes), and that plus a margin for the network fee when the buyer pays.
export const DISPUTE_RENT_LAMPORTS = 5_261_760;
export const BUYER_DISPUTE_MIN_LAMPORTS = DISPUTE_RENT_LAMPORTS + 10_000;
// The program refuses a withdrawal in the second the dispute was opened (DisputeWithdrawTooSoon), which
// makes opened_at a strict per-dispute id. Withdrawals this soon after opening wait until it has passed.
export const WITHDRAW_MIN_AGE_MS = 2_000;
// Multisig members need time to approve and execute, and resolve_dispute fails once the timeout passes.
export const SQUADS_RESOLVE_MIN_LEAD_MS = 6 * 60 * 60 * 1000;

const sol = (lamports: number) => (lamports / 1_000_000_000).toFixed(4);

function formatRemaining(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

// What raise_dispute hashed into the DisputeRecord's evidence_hash.
const evidenceHashOf = (spotId: string, reason: string, evidenceUrls: string[]) =>
  sha256(`adspaces-dispute-v1\n${spotId}\n${reason}\n${[...evidenceUrls].sort().join("\n")}`);

// Recomputed from the DB when the chain record can't be read (tests, or a record without the fields).
async function storedEvidenceHash(db: Db, dispute: { id: string; spotId: string; reason: string }) {
  const evidence = await db
    .select({ url: mediaAssets.url })
    .from(disputeEvidence)
    .innerJoin(mediaAssets, eq(mediaAssets.id, disputeEvidence.assetId))
    .where(eq(disputeEvidence.disputeId, dispute.id));
  return Array.from(evidenceHashOf(dispute.spotId, dispute.reason, evidence.map((item) => item.url)));
}

type DisputeRow = { id: string; spotId: string; reason: string; openedAt: Date };

// The values resolve_dispute must echo back. The chain's own values when readable; otherwise the DB's,
// which only match if the clocks agree to the second, so a mismatch fails on-chain rather than misapplying.
async function expectedDispute(deps: DisputeDeps, record: Partial<ChainDisputeRecord>, dispute: DisputeRow) {
  return {
    openedAt: record.openedAt ?? Math.floor(dispute.openedAt.getTime() / 1000),
    evidenceHash: record.evidenceHash ?? (await storedEvidenceHash(deps.db, dispute)),
  };
}

// Where the dispute's rent goes back to and when it times out: the chain record when readable, else
// the payer recorded at raise (the platform for disputes raised before buyer-paid rent existed).
async function disputeOnChain(deps: DisputeDeps, spotKey: PublicKey, dispute: { id: string; spotId: string; openedAt: Date }): Promise<ChainDisputeRecord> {
  const record = deps.readDisputeRecord ? await deps.readDisputeRecord(spotKey) : undefined;
  if (record === null) throw new DisputeError("the dispute is no longer open on-chain; reconciling");
  if (record) return record;
  const raised = await deps.db
    .select({ data: spotEvents.data })
    .from(spotEvents)
    .where(and(eq(spotEvents.spotId, dispute.spotId), eq(spotEvents.type, "dispute_raised")));
  const recorded = raised
    .map((row) => row.data as { disputeId?: string; rentPayer?: string; timeoutSeconds?: number } | null)
    .find((data) => data?.disputeId === dispute.id);
  const rentPayer = recorded?.rentPayer ? new PublicKey(recorded.rentPayer) : deps.rentPayer.publicKey;
  // The timeout the program snapshotted at raise (DisputeRaised.timeout_seconds); the config's current
  // value only for disputes recorded before the event carried it.
  const timeoutSeconds = recorded?.timeoutSeconds ?? (await deps.readDisputeTimeoutSeconds());
  const timesOutAt = new Date(dispute.openedAt.getTime() + timeoutSeconds * 1000);
  return { rentPayer, timesOutAt };
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

// The platform could not pay for a dispute: its key failed to sign, or it ran out of SOL (preflight
// fails, so nothing landed). Any other failure, including the buyer's wallet, is reported as is.
function platformCannotPay(error: unknown, signFailure: unknown) {
  if (signFailure !== undefined) return true;
  return error instanceof ChainError && /not enough SOL/i.test(error.message);
}

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

  const hash = evidenceHashOf(spot.id, reason, evidence.map((item) => item.url));
  const uri = listingUri(deps.listingBaseUrl, handle, listing.slug, `dispute-${spot.index + 1}`);
  const spotKey = new PublicKey(spot.chainAddress!);
  const disputeKey = pdas(deps.program.programId).dispute(spotKey);
  // Without proof only the listing's own rent payer may pay. After a reviewer rotation a listing not yet
  // adopted still names the former key, which the server no longer holds.
  if (!spot.proofSubmittedAt) {
    const { rentPayer: listingRentPayer } = await deps.readListingSnapshot(new PublicKey(listing.chainAddress!));
    if (listingRentPayer && !listingRentPayer.equals(deps.rentPayer.publicKey)) {
      throw new DisputeError("disputes on this listing can't be opened until the platform finishes a key change; please try again later", 503);
    }
  }

  const raiseInstruction = (rentPayer: PublicKey) =>
    deps.program.methods
      .raiseDispute(Array.from(hash), uri)
      .accountsStrict({
        buyer: buyer.publicKey,
        config: pdas(deps.program.programId).config(),
        rentPayer,
        listing: new PublicKey(listing.chainAddress!),
        spot: spotKey,
        dispute: disputeKey,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
  // A dispute can be withdrawn and raised again, so the key includes the attempt count.
  const previous = await deps.db.select({ id: disputes.id }).from(disputes).where(eq(disputes.spotId, spot.id));
  const idempotencyKey = `dispute:${spot.id}:${previous.length + 1}`;

  // Normal path: the platform pays the dispute's rent and co-signs, so buyers never need SOL.
  // Platform keys are wrapped so a failure to sign is told apart from the buyer's wallet failing.
  let platformFailure: unknown;
  const watched = (signer: TxSigner): TxSigner => ({
    publicKey: signer.publicKey,
    sign: async (transaction) => {
      try {
        return await signer.sign(transaction);
      } catch (error) {
        platformFailure = error;
        throw error;
      }
    },
  });
  const feePayer = watched(deps.feePayer);
  let rentPayer = deps.rentPayer.publicKey;
  let tx: ChainTxResult;
  try {
    tx = await deps.runTx({
      op: "raise_dispute",
      idempotencyKey,
      listingId: listing.id,
      spotId: spot.id,
      actorId: buyerId,
      instructions: [await raiseInstruction(deps.rentPayer.publicKey)],
      feePayer,
      signers: cosigners(feePayer, buyer, watched(deps.rentPayer)),
    });
  } catch (error) {
    if (!platformCannotPay(error, platformFailure)) throw error;
    // Fallback: the buyer's wallet pays the fee and the dispute's rent, which the program allows
    // once proof exists, so the platform being unable to sign can't block a dispute.
    if (!deps.buyerPaidDisputes || !spot.proofSubmittedAt) {
      throw new DisputeError("disputes can't be opened right now; please try again later", 503);
    }
    const [lamports] = deps.readLamports ? await deps.readLamports([buyer.publicKey]) : [null];
    if ((lamports ?? 0) < BUYER_DISPUTE_MIN_LAMPORTS) {
      throw new DisputeError(
        `the platform can't cover this dispute right now. you can open it yourself with ${sol(BUYER_DISPUTE_MIN_LAMPORTS)} SOL in your wallet (it comes back when the dispute closes); you have ${sol(lamports ?? 0)} SOL`,
        409,
      );
    }
    rentPayer = buyer.publicKey;
    tx = await deps.runTx({
      op: "raise_dispute",
      idempotencyKey: `${idempotencyKey}:buyer-paid`,
      listingId: listing.id,
      spotId: spot.id,
      actorId: buyerId,
      instructions: [await raiseInstruction(buyer.publicKey)],
      feePayer: buyer,
    });
  }
  // The event carries the timeout the program snapshotted (clamped to its bounds) and the evidence link.
  const raisedEvent = await deps.readTxEvent?.(tx.signature, "DisputeRaised").catch(() => null);
  const snapshotTimeout = raisedEvent ? eventAmount(raisedEvent, "timeoutSeconds", "timeout_seconds") : null;
  const evidenceUri = raisedEvent ? eventString(raisedEvent, "evidenceUri", "evidence_uri") : null;

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
      // Who paid the dispute's rent: it goes back there on withdraw, resolve or timeout.
      data: {
        disputeId: dispute.id,
        rentPayer: rentPayer.toBase58(),
        ...(snapshotTimeout !== null ? { timeoutSeconds: Number(snapshotTimeout) } : {}),
        ...(evidenceUri ? { evidenceUri } : {}),
      },
    });
    return { spot: updated, dispute, signature: tx.signature, buyerPaidRent: rentPayer.equals(buyer.publicKey) };
  });
}

export async function withdrawDispute(deps: DisputeDeps, buyerId: string, buyer: TxSigner, spotId: string) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  const dispute = await openDispute(deps.db, spotId);
  if (dispute.buyerId !== buyerId) throw new DisputeError("only the sponsor can withdraw this dispute", 403);
  const spotKey = new PublicKey(spot.chainAddress!);
  const record = await disputeOnChain(deps, spotKey, dispute);
  const { rentPayer, timesOutAt } = record;
  // The program refuses a withdrawal from the timeout on: the buyer's full refund has matured by then.
  if (now >= timesOutAt) {
    throw new DisputeError("this dispute has timed out, so it can't be withdrawn anymore. take the full refund instead");
  }
  // On-chain opened_at when readable (the block time of the raise), else when the row was written.
  const openedAtMs = record.openedAt !== undefined ? record.openedAt * 1000 : dispute.openedAt.getTime();
  const age = now.getTime() - openedAtMs;
  if (age < WITHDRAW_MIN_AGE_MS) {
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    await sleep(WITHDRAW_MIN_AGE_MS - Math.max(0, age));
  }
  const instruction = await deps.program.methods
    .withdrawDispute()
    .accountsStrict({
      buyer: buyer.publicKey,
      // The rent goes back to whoever paid it: the platform, or the buyer on the fallback path.
      rentPayer,
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
      data: { disputeId: dispute.id, ...staleProposalMarker(dispute) },
    });
    return { spot: updated, signature: tx.signature };
  });
}

// A decision proposed to the multisig for a dispute that then closed another way (withdrawn, timed out)
// can never execute: resolve_dispute fails with DisputeMismatch on a re-raised dispute and finds no
// dispute otherwise. The dispute row keeps its Squads index, and the closing event records it as stale
// so the review queue asks someone to cancel it in Squads.
function staleProposalMarker(dispute: { squadsTransactionIndex: number | null }) {
  return dispute.squadsTransactionIndex === null ? {} : { staleSquadsTransactionIndex: dispute.squadsTransactionIndex };
}

const STALE_REASON = { withdrawn: "the dispute was withdrawn", timed_out: "the dispute timed out" } as const;
// Squads statuses that can still be approved or executed, so the proposal needs cancelling.
const CANCELLABLE = new Set(["draft", "active", "approved", "executing"]);
// Without a Squads reader, closed disputes are listed for this long.
const STALE_LIST_MS = 30 * 24 * 60 * 60 * 1000;

export interface StaleSquadsProposal {
  disputeId: string;
  spotId: string;
  spotIndex: number;
  listingTitle: string;
  transactionIndex: number;
  proposal: string | null;
  disputeState: "withdrawn" | "timed_out";
  closedAt: Date | null;
  // Squads' own status when readable; null when the reader is missing or failed.
  status: string | null;
  message: string;
}

// Resolve proposals whose dispute is no longer open but which Squads members could still approve.
export async function staleSquadsProposals(
  db: Db,
  options: { proposalStatus?: (transactionIndex: bigint) => Promise<string | null>; now?: Date } = {},
): Promise<StaleSquadsProposal[]> {
  const now = options.now ?? new Date();
  const rows = await db
    .select({ dispute: disputes, spotIndex: spots.index, listingTitle: listings.title })
    .from(disputes)
    .innerJoin(spots, eq(spots.id, disputes.spotId))
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(inArray(disputes.state, ["withdrawn", "timed_out"]), isNotNull(disputes.squadsTransactionIndex)));
  const out: StaleSquadsProposal[] = [];
  for (const { dispute, spotIndex, listingTitle } of rows) {
    const index = dispute.squadsTransactionIndex!;
    let status: string | null = null;
    if (options.proposalStatus) {
      // Undefined when the read failed: keep listing it rather than hide a live proposal.
      const read = await options.proposalStatus(BigInt(index)).catch((error) => {
        console.error(`reading Squads proposal #${index} failed:`, error instanceof Error ? error.message : error);
        return undefined;
      });
      // Cancelled, rejected, executed or gone: nothing left to do.
      if (read !== undefined && (read === null || !CANCELLABLE.has(read))) continue;
      status = read ?? null;
    } else if (!dispute.closedAt || now.getTime() - dispute.closedAt.getTime() > STALE_LIST_MS) {
      continue;
    }
    const disputeState = dispute.state as "withdrawn" | "timed_out";
    out.push({
      disputeId: dispute.id,
      spotId: dispute.spotId,
      spotIndex,
      listingTitle,
      transactionIndex: index,
      proposal: dispute.squadsProposal,
      disputeState,
      closedAt: dispute.closedAt,
      status,
      message: `${STALE_REASON[disputeState]}; cancel Squads proposal #${index}`,
    });
  }
  return out.sort((a, b) => a.transactionIndex - b.transactionIndex);
}

// Proposals that still count: anything not rejected, cancelled or gone blocks a second one.
const LIVE_PROPOSAL = new Set(["draft", "active", "approved", "executing", "executed"]);

const decisionHash = (disputeId: string, sellerShareBps: number, decision: string) =>
  sha256(`adspaces-decision-v1\n${disputeId}\n${sellerShareBps}\n${decision}`);

type Recorded = { buyerRefund: bigint; sellerNet: bigint; fee: bigint };

type Leg = "buyer" | "seller" | "treasury";
const RESOLVE_MEMO = "adspaces: resolve dispute";
// Rent of a token account (165 bytes): what the vault pays if it must re-create one at execution.
export const TOKEN_ACCOUNT_RENT_LAMPORTS = 2_039_280;

export interface SquadsResolveMessage {
  instructions: TransactionInstruction[];
  memo?: string;
  // Paid legs whose ATA the vault message re-creates before resolving (CreateIdempotent).
  guarded: Leg[];
  // Paid legs left unguarded because the proposal would not fit one transaction.
  unguarded: Leg[];
}

// The vault message for a Squads resolve: CreateIdempotent for each paid leg's ATA, then resolve_dispute.
// The buyer comes first (it is the party that gains from blocking: a missed timeout refunds it in full),
// then the seller. The treasury is skipped when it is the vault itself, whose accounts only the multisig
// controls. vault_transaction_create carries the whole message in one transaction, so guards (and then
// the memo) are dropped from the end until it fits. A token account whose owner was reassigned still
// fails CreateIdempotent; that case needs a rebuilt decision (runbook section 2, rule 6).
export function squadsResolveMessage(
  squads: Pick<SquadsProposer, "multisig" | "vault" | "proposer">,
  feePayer: PublicKey,
  resolveInstruction: TransactionInstruction,
  paid: readonly Leg[],
  owners: Record<Leg, PublicKey>,
  mint: PublicKey,
): SquadsResolveMessage {
  const guardable = paid.filter((leg) => !owners[leg].equals(squads.vault));
  for (let count = guardable.length; count >= 0; count -= 1) {
    const guarded = guardable.slice(0, count);
    const instructions = [...guarded.map((leg) => createAtaIdempotent(squads.vault, owners[leg], mint)), resolveInstruction];
    for (const memo of [RESOLVE_MEMO, undefined]) {
      const size = squadsProposalSize({ multisig: squads.multisig, proposer: squads.proposer.publicKey, feePayer, instructions, memo });
      if (size <= MAX_TRANSACTION_BYTES) return { instructions, memo, guarded, unguarded: guardable.slice(count) };
    }
  }
  return { instructions: [resolveInstruction], memo: RESOLVE_MEMO, guarded: [], unguarded: guardable };
}

// What the reviewer should know about a resolve proposal before members approve it.
async function squadsResolveWarnings(deps: DisputeDeps, squads: SquadsProposer, message: SquadsResolveMessage): Promise<string[]> {
  const warnings: string[] = [];
  if (message.unguarded.length) {
    warnings.push(
      `the proposal had no room to also re-create the ${message.unguarded.join(" and ")} token account at execution; if execution fails because that account was closed, decide again to rebuild it`,
    );
  }
  if (message.guarded.length && deps.readLamports) {
    const [lamports] = await deps.readLamports([squads.vault]).catch(() => [null]);
    const needed = message.guarded.length * TOKEN_ACCOUNT_RENT_LAMPORTS;
    if ((lamports ?? 0) < needed) {
      warnings.push(
        `the multisig vault holds ${sol(lamports ?? 0)} SOL; keep at least ${sol(needed)} SOL there so a closed token account can be re-created when the proposal executes`,
      );
    }
  }
  return warnings;
}

// Amounts the program reported in DisputeResolved, or null when the event is missing or incomplete.
function resolvedAmounts(event: Record<string, unknown> | null | undefined): Recorded | null {
  if (!event) return null;
  const buyerRefund = eventAmount(event, "buyerRefund", "buyer_refund");
  const sellerNet = eventAmount(event, "sellerAmount", "seller_amount");
  const fee = eventAmount(event, "fee", "fee");
  return buyerRefund !== null && sellerNet !== null && fee !== null ? { buyerRefund, sellerNet, fee } : null;
}

// DisputeResolved.decided_at and decision_uri (programs from the final CertiK fixes on); null when the
// event predates them.
function resolvedDecision(event: Record<string, unknown> | null | undefined) {
  if (!event) return { decidedAt: null, decisionUri: null };
  const decidedAt = eventAmount(event, "decidedAt", "decided_at");
  return {
    decidedAt: decidedAt !== null && decidedAt > 0n ? new Date(Number(decidedAt) * 1000) : null,
    decisionUri: eventString(event, "decisionUri", "decision_uri"),
  };
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
    // From the DisputeResolved event: the chain's decision time (the dispute closes then) and link.
    decidedAt?: Date | null;
    decisionUri?: string | null;
  },
) {
  const { spotId, disputeId, sellerShareBps, decision, resolvedBy, recorded, now } = input;
  const closedAt = input.decidedAt ?? now;
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
      .set({ state: "resolved", sellerShareBps, decision, resolvedBy, closedAt })
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
      data: {
        disputeId,
        sellerShareBps,
        ...(input.decisionUri ? { decisionUri: input.decisionUri } : {}),
        ...(input.decidedAt ? { decidedAt: input.decidedAt.toISOString() } : {}),
      },
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
  // The program refuses resolve_dispute from the timeout on; only the full refund remains then.
  const record = await disputeOnChain(deps, spotKey, dispute);
  const { rentPayer: disputeRentPayer, timesOutAt } = record;
  const expected = await expectedDispute(deps, record, dispute);
  const remainingMs = timesOutAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    throw new DisputeError("this dispute has timed out and can no longer be resolved; refund the sponsor in full instead");
  }
  if (squads && remainingMs < SQUADS_RESOLVE_MIN_LEAD_MS) {
    throw new DisputeError(
      `only ${formatRemaining(remainingMs)} left before this dispute times out at ${timesOutAt.toISOString()}; a multisig proposal needs at least ${SQUADS_RESOLVE_MIN_LEAD_MS / 3_600_000} hours to be approved and executed, so let it time out (full refund to the sponsor)`,
    );
  }
  const snapshot = await deps.readListingSnapshot(listingKey);
  const balance = await deps.readVaultBalance(vault);
  if (balance <= 0n) throw new DisputeError("vault is empty; reconciling");
  const split = calculateDisputeSplit(snapshot.fees, spot.price, balance, sellerShareBps);
  const legs = disputeLegs(snapshot.fees, sellerShareBps, split);
  const owners = { seller, buyer, treasury: snapshot.treasury };
  const paid = (["buyer", "seller", "treasury"] as const).filter((leg) => legs[leg]);

  const addresses = pdas(deps.program.programId);
  const proofKey = addresses.proof(spotKey);
  // Only the destinations of paid legs are passed (and created when missing): a party whose leg is zero
  // can't block the resolution by closing or reassigning its token account.
  const atas: TransactionInstruction[] = [];
  for (const leg of paid) {
    if (!(await deps.accountExists(associatedTokenAddress(owners[leg], deps.mint)))) {
      atas.push(createAtaIdempotent(deps.feePayer.publicKey, owners[leg], deps.mint));
    }
  }
  const destination = (leg: keyof typeof owners) => (legs[leg] ? associatedTokenAddress(owners[leg], deps.mint) : null);
  const hash = decisionHash(dispute.id, sellerShareBps, decision);
  const uri = listingUri(deps.listingBaseUrl, handle, listing.slug, `decision-${spot.index + 1}`);
  const resolveInstruction = await deps.program.methods
    // opened_at and evidence_hash bind the decision to this dispute: if it is withdrawn and raised again
    // before a Squads proposal executes, the program rejects the proposal (DisputeMismatch).
    .resolveDispute(sellerShareBps, Array.from(hash), uri, new BN(expected.openedAt), expected.evidenceHash)
    .accountsStrict({
      resolver: authority,
      rentPayer: snapshot.rentPayer ?? deps.rentPayer.publicKey,
      disputeRentPayer,
      config: addresses.config(),
      listing: listingKey,
      spot: spotKey,
      dispute: addresses.dispute(spotKey),
      vault,
      sellerAta: destination("seller"),
      seller,
      buyerAta: destination("buyer"),
      treasuryAta: destination("treasury"),
      proof: spot.proofSubmittedAt ? proofKey : null,
      usdcMint: deps.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  if (squads) {
    // Missing token accounts are created by the platform now, so the proposal can execute as built.
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
    // A party could still close its token account between proposal and execution, which would make the
    // approved proposal fail and force a re-approval (TRIAGE-3 K3). So the vault message itself first
    // re-creates each paid leg's ATA (CreateIdempotent, paid by the vault; a no-op while it exists).
    const guard = squadsResolveMessage(squads, deps.feePayer.publicKey, resolveInstruction, paid, owners, deps.mint);
    const warnings = await squadsResolveWarnings(deps, squads, guard);
    const proposal = await squads.propose(guard.instructions, guard.memo);
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
    return { spot, dispute: updated, pending, signature: tx.signature, timesOutAt, guardedAccounts: guard.guarded, warnings };
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
    ...resolvedDecision(resolved),
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
        // When the multisig executed it, which can be long after the proposal.
        ...resolvedDecision(resolution.event),
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
  const listingKey = new PublicKey(listing.chainAddress!);
  const spotKey = new PublicKey(spot.chainAddress!);
  // The chain snapshots the timeout at raise, so later config changes don't move it.
  const { rentPayer: disputeRentPayer, timesOutAt } = await disputeOnChain(deps, spotKey, dispute);
  if (now < timesOutAt) throw new DisputeError(`auto-refund opens ${timesOutAt.toISOString()}`);

  const vault = new PublicKey(spot.vaultAddress!);
  const buyer = new PublicKey(spot.buyerWallet!);
  const balance = await deps.readVaultBalance(vault);
  const { rentPayer: listingRentPayer } = await deps.readListingSnapshot(listingKey);
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
        rentPayer: listingRentPayer ?? deps.rentPayer.publicKey,
        disputeRentPayer,
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
      data: { disputeId: dispute.id, ...staleProposalMarker(dispute) },
    });
    return { spot: updated, settlement, signature: tx.signature };
  });
}
