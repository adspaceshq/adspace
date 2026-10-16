import { and, eq, inArray, lt, or } from "drizzle-orm";
import anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { bids, listings, spotEvents, spots, users, type SponsorBrand } from "../db/schema.js";
import { nextSpotState } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import type { TxSigner } from "../chain/signers.js";
import { recordTermsAcceptance } from "./terms.js";

export class PurchaseError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export interface PurchaseDeps {
  db: Db;
  program: AdspacesProgram;
  mint: PublicKey;
  feePayer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  // The program extends auction deadlines on late bids; the chain is the source of truth.
  fetchListingDeadline: (listing: PublicKey) => Promise<Date>;
  // Lets checkout fail with a clear message before anything is sent to Solana.
  readTokenBalance?: (owner: PublicKey) => Promise<bigint>;
  now?: () => Date;
}

// Bids this far above the minimum are almost certainly a unit or typing mistake.
export const MAX_BID_MULTIPLE = 100n;

const usd = (base: bigint) => `$${(base / 1_000_000n).toLocaleString("en-US")}.${(base % 1_000_000n).toString().padStart(6, "0").slice(0, 2)}`;

async function assertFunds(deps: PurchaseDeps, owner: PublicKey, amount: bigint) {
  if (!deps.readTokenBalance) return;
  const balance = await deps.readTokenBalance(owner);
  if (balance < amount) throw new PurchaseError(`not enough USDC: you have ${usd(balance)} and this needs ${usd(amount)}`, 409);
}

// `signer.publicKey` is the user's embedded wallet; it signs as buyer/bidder.
export interface Purchaser {
  id: string;
  signer: TxSigner;
  // The terms version the sponsor agreed to at checkout (the route checks it is current).
  // Recorded before anything is sent to Solana, so every on-chain purchase has a consent row.
  termsVersion?: string;
}

// The sponsor tells the creator what to show on the spot; validated before any chain call.
export function parseBrand(input: unknown): SponsorBrand {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const text = (key: string, max: number) => {
    const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (value.length > max) throw new PurchaseError(`brand ${key} is too long`, 400);
    return value || undefined;
  };
  const name = text("name", 80);
  if (!name) throw new PurchaseError("tell the creator your brand name", 400);
  const link = text("link", 200);
  if (link && !/^https:\/\/[^\s]+\.[^\s]+$/i.test(link)) throw new PurchaseError("brand link must be an https URL", 400);
  // The creator prints or sticks this on the item, and it's shown publicly once the spot is sold.
  const logoUrl = text("logoUrl", 500);
  if (!logoUrl) throw new PurchaseError("upload your logo so the creator knows what to put on the spot", 400);
  if (!/^https:\/\/res\.cloudinary\.com\/[^/\s]+\/image\/upload\//i.test(logoUrl)) {
    throw new PurchaseError("upload the logo through adspaces", 400);
  }
  const handle = text("handle", 40)?.replace(/^@+/, "");
  return { name, logoUrl, ...(link ? { link } : {}), ...(handle ? { handle } : {}) };
}

async function loadSpot(db: Db, spotId: string) {
  const [row] = await db
    .select({ spot: spots, listing: listings })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.id, spotId));
  if (!row) throw new PurchaseError("spot not found", 404);
  const { spot, listing } = row;
  if (listing.state !== "published" || !listing.chainAddress) throw new PurchaseError("listing is not live");
  if (!spot.chainAddress || !spot.vaultAddress) throw new PurchaseError("spot is not published on-chain");
  return { spot, listing };
}

function assertPurchaser(listing: { sellerId: string }, purchaser: Purchaser, now: Date, deadline: Date) {
  if (purchaser.id === listing.sellerId) throw new PurchaseError("you can't buy space on your own listing");
  if (now >= deadline) throw new PurchaseError("this listing has closed");
}

export async function claimSpot(deps: PurchaseDeps, spotId: string, buyer: Purchaser, brandInput: unknown) {
  const now = deps.now?.() ?? new Date();
  const brand = parseBrand(brandInput);
  const { spot, listing } = await loadSpot(deps.db, spotId);
  if (listing.mode !== "fixed") throw new PurchaseError("this spot is an auction; place a bid instead");
  assertPurchaser(listing, buyer, now, listing.deadline);
  if (spot.state !== "open") throw new PurchaseError("this spot has already been taken");
  await assertFunds(deps, buyer.signer.publicKey, spot.price);
  if (buyer.termsVersion) await recordTermsAcceptance(deps.db, { userId: buyer.id, context: "claim", termsVersion: buyer.termsVersion, spotId: spot.id, at: now });

  const listingKey = new PublicKey(listing.chainAddress!);
  const spotKey = new PublicKey(spot.chainAddress!);
  const addresses = pdas(deps.program.programId);
  const instruction = await deps.program.methods
    .claimSpot()
    .accountsStrict({
      buyer: buyer.signer.publicKey,
      listing: listingKey,
      spot: spotKey,
      vault: new PublicKey(spot.vaultAddress!),
      buyerAta: associatedTokenAddress(buyer.signer.publicKey, deps.mint),
      config: addresses.config(),
      usdcMint: deps.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const tx = await deps.runTx({
    op: "claim_spot",
    idempotencyKey: `claim:${spot.id}:${buyer.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: buyer.id,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: [buyer.signer],
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("open", "claimed");
    const [updated] = await trx
      .update(spots)
      .set({
        state: to,
        buyerId: buyer.id,
        buyerWallet: buyer.signer.publicKey.toBase58(),
        amount: spot.price,
        brand,
        updatedAt: now,
      })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "open")))
      .returning();
    // The chain accepted the claim, so another writer changing this row is a bug, not a user error.
    if (!updated) throw new PurchaseError("spot changed while the claim was confirming; reconciling", 500);
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "open",
      toState: to,
      type: "claimed",
      actorId: buyer.id,
      chainTxId: tx.chainTxId,
      data: { amount: spot.price.toString() },
    });
    return { spot: updated, signature: tx.signature };
  });
}

export function minimumBid(
  spot: { price: bigint; amount: bigint | null; state: string },
  listing: { doubleUp: boolean; minIncrement: bigint },
): bigint {
  if (spot.state === "open" || spot.amount === null) return spot.price;
  return listing.doubleUp ? spot.amount * 2n : spot.amount + listing.minIncrement;
}

export async function placeBid(deps: PurchaseDeps, spotId: string, bidder: Purchaser, amount: bigint, brandInput: unknown) {
  const now = deps.now?.() ?? new Date();
  const brand = parseBrand(brandInput);
  const { spot, listing } = await loadSpot(deps.db, spotId);
  if (listing.mode !== "auction") throw new PurchaseError("this spot is fixed price; claim it instead");
  assertPurchaser(listing, bidder, now, listing.deadline);
  if (spot.state !== "open" && spot.state !== "funded") throw new PurchaseError("bidding has ended for this spot");
  if (spot.buyerId === bidder.id) throw new PurchaseError("you already hold the top bid");
  const minimum = minimumBid(spot, listing);
  if (amount < minimum) throw new PurchaseError(`bid must be at least ${usd(minimum)}`, 400);
  if (amount > minimum * MAX_BID_MULTIPLE) {
    throw new PurchaseError(`that bid is over ${MAX_BID_MULTIPLE}x the minimum of ${usd(minimum)}; check the amount`, 400);
  }
  await assertFunds(deps, bidder.signer.publicKey, amount);
  if (bidder.termsVersion) await recordTermsAcceptance(deps.db, { userId: bidder.id, context: "bid", termsVersion: bidder.termsVersion, spotId: spot.id, at: now });

  const listingKey = new PublicKey(listing.chainAddress!);
  const spotKey = new PublicKey(spot.chainAddress!);
  const addresses = pdas(deps.program.programId);
  const previousBidderAta = spot.buyerWallet
    ? associatedTokenAddress(new PublicKey(spot.buyerWallet), deps.mint)
    : null;
  const instruction = await deps.program.methods
    .placeBid(new anchor.BN(amount.toString()))
    .accountsStrict({
      bidder: bidder.signer.publicKey,
      listing: listingKey,
      spot: spotKey,
      vault: new PublicKey(spot.vaultAddress!),
      bidderAta: associatedTokenAddress(bidder.signer.publicKey, deps.mint),
      prevBidderAta: previousBidderAta,
      config: addresses.config(),
      usdcMint: deps.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const tx = await deps.runTx({
    op: "place_bid",
    idempotencyKey: `bid:${spot.id}:${bidder.id}:${amount}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: bidder.id,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: [bidder.signer],
  });
  const deadline = await deps.fetchListingDeadline(listingKey);

  return deps.db.transaction(async (trx) => {
    const event = spot.state === "open" ? "bid_placed" : "outbid";
    const to = nextSpotState(spot.state, event);
    const [updated] = await trx
      .update(spots)
      .set({
        state: to,
        buyerId: bidder.id,
        buyerWallet: bidder.signer.publicKey.toBase58(),
        amount,
        brand,
        updatedAt: now,
      })
      .where(
        and(
          eq(spots.id, spot.id),
          inArray(spots.state, ["open", "funded"]),
          or(eq(spots.state, "open"), lt(spots.amount, amount)),
        ),
      )
      .returning();
    if (!updated) throw new PurchaseError("spot changed while the bid was confirming; reconciling", 500);
    await trx.insert(bids).values({
      spotId: spot.id,
      bidderId: bidder.id,
      bidderWallet: bidder.signer.publicKey.toBase58(),
      amount,
      chainTxId: tx.chainTxId,
    });
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: spot.state,
      toState: to,
      type: event,
      actorId: bidder.id,
      chainTxId: tx.chainTxId,
      data: { amount: amount.toString(), previousBidderId: spot.buyerId },
    });
    if (deadline.getTime() !== listing.deadline.getTime()) {
      await trx.update(listings).set({ deadline, updatedAt: now }).where(eq(listings.id, listing.id));
    }
    return { spot: updated, signature: tx.signature, deadline };
  });
}

// Used by routes to resolve the purchaser's wallet; kept here so the check lives next to the flows.
export async function requireWallet(db: Db, userId: string): Promise<string> {
  const [user] = await db.select({ wallet: users.walletAddress }).from(users).where(eq(users.id, userId));
  if (!user?.wallet) throw new PurchaseError("set up your wallet before buying", 409);
  return user.wallet;
}
