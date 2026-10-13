import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import anchor from "@coral-xyz/anchor";
import { PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { listingPhotos, listings, mediaAssets, spots, users } from "../db/schema.js";
import { pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";
import { notify } from "./notifications.js";

// Smallest auction bid step, in USDC base units (6 decimals); mirrors the program's MIN_BID_INCREMENT.
export const MIN_BID_INCREMENT = 10_000n;

export class ListingError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Surface = (typeof listings.$inferInsert)["surface"];
type ListingRow = typeof listings.$inferSelect;

const MAX_SPOTS = 60;
const METADATA_URI_MAX_BYTES = 200;
const MIN_REVIEW_WINDOW_SECONDS = 60 * 60;
const MAX_REVIEW_WINDOW_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_REVIEW_WINDOW_SECONDS = 48 * 60 * 60;
export const DEFAULT_DELIVERY_DAYS = 7;

export interface DraftSpotInput {
  label?: string;
  price: bigint;
  layout: { x: number; y: number; w: number; h?: number; view?: string };
}

export interface DraftInput {
  surface: Surface;
  title: string;
  description?: string;
  audience?: { followers?: number; event?: string; location?: string };
  mode: "fixed" | "auction";
  deadline: Date;
  artworkDueAt?: Date;
  deliveryDueAt?: Date;
  minIncrement?: bigint;
  doubleUp?: boolean;
  spots: DraftSpotInput[];
  photoAssetIds?: string[];
}

export interface FeePolicy {
  feeBps: number;
  upliftFeeBps: number;
  maxFeeBps: number;
}

export type ReviewDecision =
  | { action: "approve"; fees: FeePolicy; reviewWindowSeconds?: number; deliveryDueAt?: Date; note?: string }
  | { action: "request_changes"; note: string }
  | { action: "reject"; note: string };

// Mirrors the program's validate_fee_policy so bad values never reach create_listing.
export function validateFeePolicy(mode: "fixed" | "auction", fees: FeePolicy, configFloorBps: number): void {
  const { feeBps, upliftFeeBps, maxFeeBps } = fees;
  for (const value of [feeBps, upliftFeeBps, maxFeeBps]) {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) throw new ListingError("fees must be 0-10000 bps");
  }
  if (feeBps < configFloorBps) throw new ListingError(`fee must be at least the platform floor of ${configFloorBps} bps`);
  if (mode === "fixed") {
    if (upliftFeeBps !== 0 || maxFeeBps !== feeBps) {
      throw new ListingError("fixed listings use a flat fee: uplift must be 0 and cap must equal the fee");
    }
  } else if (!(feeBps <= maxFeeBps && maxFeeBps <= upliftFeeBps)) {
    throw new ListingError("auction fees must satisfy base <= cap <= uplift");
  }
}

function validateSchedule(deadline: Date, artworkDueAt: Date, deliveryDueAt: Date, now: Date): void {
  if (deadline <= now) throw new ListingError("deadline must be in the future");
  if (artworkDueAt < deadline) throw new ListingError("artwork due date can't be before the deadline");
  if (deliveryDueAt <= artworkDueAt) throw new ListingError("delivery date must be after the artwork due date");
}

function slugify(title: string): string {
  const base = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "listing"}-${randomBytes(4).toString("hex")}`;
}

export function slugHash(slug: string): Buffer {
  return createHash("sha256").update(slug).digest().subarray(0, 16);
}

async function loadOwned(db: Db, listingId: string, sellerId: string): Promise<ListingRow> {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new ListingError("listing not found", 404);
  if (listing.sellerId !== sellerId) throw new ListingError("this listing belongs to someone else", 403);
  return listing;
}

const MAX_PHOTOS = 6;

// A spot's `view` is the index (as a string) of the photo it sits on; absent means the cover.
// "0" is stored as absent so every cover spot looks the same.
function normalizeView(view: unknown, photoCount: number): string | undefined {
  if (view === undefined || view === null) return undefined;
  const index = typeof view === "string" && /^\d{1,2}$/.test(view) ? Number(view) : Number.NaN;
  if (!Number.isInteger(index) || index >= Math.max(photoCount, 1)) {
    throw new ListingError(
      photoCount > 1
        ? `each spot must sit on one of the listing's ${photoCount} photos (view "0" to "${photoCount - 1}")`
        : "spots can only sit on the cover photo until you add more photos",
    );
  }
  return index === 0 ? undefined : String(index);
}

function normalizeDraft(input: DraftInput, now: Date) {
  const title = input.title.trim();
  if (!title || title.length > 80) throw new ListingError("title is required (max 80 characters)");
  if ((input.description ?? "").length > 2000) throw new ListingError("keep the description under 2000 characters");
  if (input.spots.length === 0 || input.spots.length > MAX_SPOTS) throw new ListingError(`add 1-${MAX_SPOTS} spots`);
  if (input.spots.some((spot) => spot.price <= 0n)) throw new ListingError("every spot needs a price above zero");
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (input.spots.some(({ layout }) => !inRange(layout.x, 0, 100) || !inRange(layout.y, 0, 100) || !inRange(layout.w, 2, 60))) {
    throw new ListingError("spots must sit on the photo (position 0-100%, size 2-60%)");
  }
  const artworkDueAt = input.artworkDueAt ?? input.deadline;
  const deliveryDueAt =
    input.deliveryDueAt ?? new Date(artworkDueAt.getTime() + DEFAULT_DELIVERY_DAYS * 24 * 60 * 60 * 1000);
  validateSchedule(input.deadline, artworkDueAt, deliveryDueAt, now);
  const doubleUp = input.mode === "auction" && Boolean(input.doubleUp);
  const minIncrement = input.mode === "auction" && !doubleUp ? (input.minIncrement ?? 0n) : 0n;
  if (input.mode === "auction" && !doubleUp && minIncrement <= 0n) {
    throw new ListingError("auctions need a minimum bid increment, or double-up bidding");
  }
  // The program rejects smaller steps at publish (MIN_BID_INCREMENT), so refuse them up front.
  if (input.mode === "auction" && !doubleUp && minIncrement < MIN_BID_INCREMENT) {
    throw new ListingError("the minimum bid increment is 0.01 USDC");
  }
  const photoIds = [...new Set(input.photoAssetIds ?? [])];
  if (photoIds.length > MAX_PHOTOS) throw new ListingError(`add at most ${MAX_PHOTOS} photos`);
  const spotRows = input.spots.map((spot, index) => {
    const { view, ...layout } = spot.layout;
    const normalizedView = normalizeView(view, photoIds.length);
    return {
      index,
      label: spot.label?.trim() ?? "",
      price: spot.price,
      layout: normalizedView === undefined ? layout : { ...layout, view: normalizedView },
    };
  });
  return {
    fields: {
      surface: input.surface,
      title,
      description: input.description?.trim() ?? "",
      audience: input.audience ?? {},
      mode: input.mode,
      deadline: input.deadline,
      artworkDueAt,
      deliveryDueAt,
      minIncrement,
      doubleUp,
    },
    spots: spotRows,
    photoIds,
  };
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// Photos must be the seller's own listing-photo uploads; order is the order given.
async function replacePhotos(trx: Tx, listingId: string, sellerId: string, photoIds: string[]) {
  if (photoIds.length > 0) {
    const owned = await trx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, photoIds), eq(mediaAssets.ownerId, sellerId), eq(mediaAssets.kind, "listing_photo")));
    if (owned.length !== photoIds.length) throw new ListingError("one of the photos isn't yours or doesn't exist");
  }
  await trx.delete(listingPhotos).where(eq(listingPhotos.listingId, listingId));
  if (photoIds.length > 0) {
    await trx.insert(listingPhotos).values(photoIds.map((assetId, position) => ({ listingId, assetId, position })));
  }
}

export async function createDraft(db: Db, sellerId: string, input: DraftInput, now = new Date()) {
  const draft = normalizeDraft(input, now);
  return db.transaction(async (trx) => {
    const [listing] = await trx
      .insert(listings)
      .values({ ...draft.fields, slug: slugify(draft.fields.title), sellerId, state: "draft" })
      .returning();
    const created = await trx
      .insert(spots)
      .values(draft.spots.map((spot) => ({ ...spot, listingId: listing.id })))
      .returning();
    await replacePhotos(trx, listing.id, sellerId, draft.photoIds);
    return { listing, spots: created };
  });
}

// Drafts and listings sent back for changes are fully editable; nothing is on-chain yet.
export async function updateDraft(db: Db, sellerId: string, listingId: string, input: DraftInput, now = new Date()) {
  const listing = await loadOwned(db, listingId, sellerId);
  if (listing.state !== "draft" && listing.state !== "changes_requested") {
    throw new ListingError("only drafts and listings with requested changes can be edited", 409);
  }
  const draft = normalizeDraft(input, now);
  return db.transaction(async (trx) => {
    const [updated] = await trx
      .update(listings)
      .set({ ...draft.fields, updatedAt: now })
      .where(and(eq(listings.id, listingId), inArray(listings.state, ["draft", "changes_requested"])))
      .returning();
    if (!updated) throw new ListingError("listing changed while saving; reload and try again", 409);
    await trx.delete(spots).where(eq(spots.listingId, listingId));
    const created = await trx
      .insert(spots)
      .values(draft.spots.map((spot) => ({ ...spot, listingId })))
      .returning();
    await replacePhotos(trx, listingId, sellerId, draft.photoIds);
    return { listing: updated, spots: created };
  });
}

export async function submitForReview(db: Db, sellerId: string, listingId: string) {
  const listing = await loadOwned(db, listingId, sellerId);
  const [photo] = await db.select({ id: listingPhotos.assetId }).from(listingPhotos).where(eq(listingPhotos.listingId, listingId)).limit(1);
  if (!photo) throw new ListingError("add at least one photo before submitting");
  if (listing.state !== "draft" && listing.state !== "changes_requested") {
    throw new ListingError("only drafts can be submitted for review", 409);
  }
  const [updated] = await db
    .update(listings)
    .set({ state: "in_review", updatedAt: new Date() })
    .where(and(eq(listings.id, listingId), inArray(listings.state, ["draft", "changes_requested"])))
    .returning();
  return updated;
}

export async function reviewListing(
  db: Db,
  reviewerId: string,
  listingId: string,
  decision: ReviewDecision,
  configFloorBps: number,
  now = new Date(),
) {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new ListingError("listing not found", 404);
  if (listing.sellerId === reviewerId) throw new ListingError("you can't review your own listing", 403);
  if (listing.state !== "in_review") throw new ListingError("this listing is not waiting for review", 409);

  const base = { reviewedBy: reviewerId, reviewedAt: now, updatedAt: now };
  let changes: Partial<typeof listings.$inferInsert>;
  if (decision.action === "approve") {
    validateFeePolicy(listing.mode, decision.fees, configFloorBps);
    const reviewWindowSeconds = decision.reviewWindowSeconds ?? listing.reviewWindowSeconds;
    if (reviewWindowSeconds < MIN_REVIEW_WINDOW_SECONDS || reviewWindowSeconds > MAX_REVIEW_WINDOW_SECONDS) {
      throw new ListingError("review window must be between 1 hour and 30 days");
    }
    const deliveryDueAt = decision.deliveryDueAt ?? listing.deliveryDueAt;
    validateSchedule(listing.deadline, listing.artworkDueAt, deliveryDueAt, now);
    changes = {
      ...base,
      state: "approved",
      ...decision.fees,
      reviewWindowSeconds,
      deliveryDueAt,
      reviewNote: decision.note?.trim() || null,
    };
  } else {
    const note = decision.note.trim();
    if (!note) throw new ListingError("tell the creator what to change");
    changes = { ...base, state: decision.action === "reject" ? "rejected" : "changes_requested", reviewNote: note };
  }
  const [updated] = await db
    .update(listings)
    .set(changes)
    .where(and(eq(listings.id, listingId), eq(listings.state, "in_review")))
    .returning();
  if (!updated) throw new ListingError("listing changed during review; reload and try again", 409);
  const outcome = {
    approved: { title: `"${updated.title}" was approved`, body: "accept the terms to publish it on-chain." },
    changes_requested: { title: `changes requested on "${updated.title}"`, body: updated.reviewNote ?? "" },
    rejected: { title: `"${updated.title}" wasn't approved`, body: updated.reviewNote ?? "" },
  }[updated.state as "approved" | "changes_requested" | "rejected"];
  if (outcome) {
    await notify(db, [
      {
        userId: updated.sellerId,
        type: `listing_${updated.state}`,
        category: "listings",
        ...outcome,
        href: `/sell/listings/${updated.id}`,
        dedupeKey: `listing:${updated.id}:${updated.state}:${updated.updatedAt.getTime()}`,
      },
    ]);
  }
  return updated;
}

export interface PublishDeps {
  db: Db;
  program: AdspacesProgram;
  mint: PublicKey;
  reviewer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  // Seller pays rent for listing and spot accounts; top up their SOL first if needed.
  ensureSellerFunding: (seller: PublicKey) => Promise<void>;
  metadataBaseUrl: string;
  termsVersion: string;
  now?: () => Date;
}

const bn = (value: bigint | number) => new anchor.BN(value.toString());
const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

// Accepting terms and publishing are one step for the creator. Each chain write is keyed
// so a publish that fails midway can be retried and only the missing accounts are created.
export async function acceptTermsAndPublish(deps: PublishDeps, sellerId: string, listingId: string, seller: TxSigner) {
  const now = deps.now?.() ?? new Date();
  const listing = await loadOwned(deps.db, listingId, sellerId);
  if (listing.state === "published") throw new ListingError("this listing is already live", 409);
  if (listing.state !== "approved" && listing.state !== "publishing") {
    throw new ListingError("this listing isn't approved yet", 409);
  }
  if (listing.deadline <= now) throw new ListingError("the deadline has passed; ask for a new review", 409);
  if (listing.sellerWallet && listing.sellerWallet !== seller.publicKey.toBase58()) {
    throw new ListingError("publish with the wallet you started with", 409);
  }
  const [owner] = await deps.db.select({ handle: users.handle }).from(users).where(eq(users.id, sellerId));
  const metadataUri = `${deps.metadataBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(owner.handle)}/${encodeURIComponent(listing.slug)}`;
  if (Buffer.byteLength(metadataUri) > METADATA_URI_MAX_BYTES) throw new ListingError("listing link is too long to publish", 500);

  const addresses = pdas(deps.program.programId);
  const config = addresses.config();
  const listingKey = addresses.listing(seller.publicKey, slugHash(listing.slug));
  const listingSpots = await deps.db.select().from(spots).where(eq(spots.listingId, listing.id)).orderBy(asc(spots.index));

  await deps.db
    .update(listings)
    .set({
      state: "publishing",
      sellerWallet: seller.publicKey.toBase58(),
      termsVersion: deps.termsVersion,
      termsAcceptedAt: listing.termsAcceptedAt ?? now,
      updatedAt: now,
    })
    .where(and(eq(listings.id, listing.id), inArray(listings.state, ["approved", "publishing"])));

  await deps.ensureSellerFunding(seller.publicKey);

  const createListing = await deps.program.methods
    .createListing(
      Array.from(slugHash(listing.slug)),
      metadataUri,
      listing.mode === "auction" ? 1 : 0,
      bn(seconds(listing.deadline)),
      bn(seconds(listing.artworkDueAt)),
      bn(seconds(listing.deliveryDueAt)),
      bn(listing.reviewWindowSeconds),
      bn(listing.minIncrement),
      listing.doubleUp,
      listing.feeBps!,
      listing.upliftFeeBps!,
      listing.maxFeeBps!,
    )
    .accountsStrict({
      seller: seller.publicKey,
      reviewer: deps.reviewer.publicKey,
      listing: listingKey,
      config,
      reviewAuthority: addresses.reviewAuthority(config),
      usdcMint: deps.mint,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  await deps.runTx({
    op: "publish_listing",
    idempotencyKey: `publish:${listing.id}`,
    listingId: listing.id,
    actorId: sellerId,
    instructions: [createListing],
    feePayer: deps.reviewer,
    signers: [seller],
  });

  for (const spot of listingSpots) {
    const spotKey = addresses.spot(listingKey, spot.index);
    const addSpot = await deps.program.methods
      .addSpot(bn(spot.price))
      .accountsStrict({
        seller: seller.publicKey,
        listing: listingKey,
        spot: spotKey,
        vault: addresses.vault(spotKey),
        config,
        usdcMint: deps.mint,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
        // Spots after approval need the review authority; the reviewer key is the fee payer and signs.
        reviewer: deps.reviewer.publicKey,
        reviewAuthority: addresses.reviewAuthority(config),
      })
      .instruction();
    await deps.runTx({
      op: "publish_listing",
      idempotencyKey: `add_spot:${spot.id}`,
      listingId: listing.id,
      spotId: spot.id,
      actorId: sellerId,
      instructions: [addSpot],
      feePayer: deps.reviewer,
      signers: [seller],
    });
    await deps.db
      .update(spots)
      .set({ chainAddress: spotKey.toBase58(), vaultAddress: addresses.vault(spotKey).toBase58(), updatedAt: now })
      .where(eq(spots.id, spot.id));
  }

  const [published] = await deps.db
    .update(listings)
    .set({ state: "published", chainAddress: listingKey.toBase58(), publishedAt: now, updatedAt: now })
    .where(and(eq(listings.id, listing.id), eq(listings.state, "publishing")))
    .returning();
  if (!published) throw new ListingError("listing changed while publishing; reload and try again", 409);
  return published;
}
