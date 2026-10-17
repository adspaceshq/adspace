import { and, asc, eq, inArray, isNotNull, lte } from "drizzle-orm";
import { PublicKey, type TransactionInstruction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { listings, settlements, spotEvents, spots } from "../db/schema.js";
import { nextSpotState, terminalSpotStates } from "../domain/spot-state.js";
import { associatedTokenAddress, pdas, TOKEN_PROGRAM_ID, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import { cosigners, type TxSigner } from "../chain/signers.js";
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
  // The platform key that pays listing rent today (the reviewer key). It signs closes, which the program
  // allows only for the key recorded on the listing.
  rentPayer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  accountExists: (address: PublicKey) => Promise<boolean>;
  // Each listing's on-chain rent payer, null once the account is gone. adopt_listing moves it to a new
  // reviewer key, so it can differ from `rentPayer`. Without a reader, `rentPayer` is assumed.
  readListingRentPayers?: (listings: PublicKey[]) => Promise<Array<PublicKey | null>>;
  now?: () => Date;
}

export const ADOPT_FIRST = "adopt listings in ops first (after a reviewer key rotation)";

// The rent payer recorded on the listing account; it receives rent back and must sign closes.
async function listingRentPayer(deps: RefundDeps, listing: PublicKey): Promise<PublicKey> {
  if (!deps.readListingRentPayers) return deps.rentPayer.publicKey;
  const [payer] = await deps.readListingRentPayers([listing]);
  if (!payer) throw new RefundError("the listing is no longer on-chain; reconciling");
  return payer;
}

// Closing needs the listing's rent payer to sign, which the server can only do for its own key.
async function requireServerRentPayer(deps: RefundDeps, listing: PublicKey) {
  const payer = await listingRentPayer(deps, listing);
  if (!payer.equals(deps.rentPayer.publicKey)) {
    throw new RefundError(`this listing's rent payer is ${payer.toBase58()}, not the server key ${deps.rentPayer.publicKey.toBase58()}; ${ADOPT_FIRST}`);
  }
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
  const rentPayer = await listingRentPayer(deps, new PublicKey(listing.chainAddress!));
  instructions.push(
    await deps.program.methods
      .refundSpot()
      .accountsStrict({
        caller: caller.publicKey,
        listing: new PublicKey(listing.chainAddress!),
        rentPayer,
        spot: new PublicKey(spot.chainAddress!),
        vault,
        buyerAta: associatedTokenAddress(buyer, deps.mint),
        usdcMint: deps.mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        // Proof exists once submitted; the program closes it so its rent returns to the rent payer.
        proof: spot.proofSubmittedAt ? pdas(deps.program.programId).proof(new PublicKey(spot.chainAddress!)) : null,
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

// Admin action: withdraws an unsold spot from sale and returns its rent to the platform.
// Only after the listing deadline, unless `force` takes it off sale early.
export async function closeSpot(deps: RefundDeps, adminId: string, spotId: string, options: { force?: boolean } = {}) {
  const now = deps.now?.() ?? new Date();
  const { spot, listing } = await loadSpot(deps.db, spotId);
  if (spot.state !== "open") throw new RefundError("only unsold spots can be closed");
  if (now < listing.deadline && !options.force) throw new RefundError("the listing is still selling; force to close it early");
  const seller = new PublicKey(listing.sellerWallet!);
  const listingKey = new PublicKey(listing.chainAddress!);
  await requireServerRentPayer(deps, listingKey);
  const vault = new PublicKey(spot.vaultAddress!);
  // Anything sent to the open spot's vault is swept to the creator's token account before it closes.
  // The program needs that account only when there is something to sweep (SellerAccountRequired).
  const sweep = (await deps.readVaultBalance(vault)) > 0n;
  const instruction = await deps.program.methods
    .closeSpot()
    .accountsStrict({
      rentPayer: deps.rentPayer.publicKey,
      listing: listingKey,
      spot: new PublicKey(spot.chainAddress!),
      vault,
      sellerAta: sweep ? associatedTokenAddress(seller, deps.mint) : null,
      usdcMint: deps.mint,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const tx = await deps.runTx({
    op: "close_spot",
    idempotencyKey: `close-spot:${spot.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: adminId,
    instructions: sweep ? [createAtaIdempotent(deps.feePayer.publicKey, seller, deps.mint), instruction] : [instruction],
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, deps.rentPayer),
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
      actorId: adminId,
      chainTxId: tx.chainTxId,
      data: { force: Boolean(options.force), swept: sweep },
    });
    return { spot: updated, signature: tx.signature };
  });
}

// Admin action: the program requires every spot account to be closed first; settled, refunded
// and cancelled spots are. The listing's rent returns to the platform.
export async function closeListing(deps: RefundDeps, adminId: string, listingId: string) {
  const now = deps.now?.() ?? new Date();
  const [listing] = await deps.db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new RefundError("listing not found", 404);
  if (listing.state !== "published" || !listing.chainAddress) throw new RefundError("only live listings can be closed");
  const listingSpots = await deps.db.select().from(spots).where(eq(spots.listingId, listing.id));
  const active = listingSpots.filter((spot) => !terminalSpotStates.has(spot.state));
  if (active.length > 0) {
    throw new RefundError(`finish or close ${active.length} remaining spot${active.length === 1 ? "" : "s"} first`);
  }
  await requireServerRentPayer(deps, new PublicKey(listing.chainAddress));
  const instruction = await deps.program.methods
    .closeListing()
    .accountsStrict({ rentPayer: deps.rentPayer.publicKey, listing: new PublicKey(listing.chainAddress) })
    .instruction();
  const tx = await deps.runTx({
    op: "close_listing",
    idempotencyKey: `close-listing:${listing.id}`,
    listingId: listing.id,
    actorId: adminId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, deps.rentPayer),
  });
  const [closed] = await deps.db
    .update(listings)
    .set({ state: "closed", closedAt: now, updatedAt: now })
    .where(and(eq(listings.id, listing.id), inArray(listings.state, ["published"])))
    .returning();
  if (!closed) throw new RefundError("listing changed while closing; reconciling", 500);
  return { listing: closed, signature: tx.signature };
}

export interface RentReportDeps {
  db: Db;
  // Lamports held by each account, null once it is closed.
  readLamports: (addresses: PublicKey[]) => Promise<Array<number | null>>;
  // Each listing's on-chain rent payer and the server's key: rent returns to the former, and only the
  // server's key can close. Without them every listing is assumed to be the server's.
  readListingRentPayers?: (listings: PublicKey[]) => Promise<Array<PublicKey | null>>;
  serverRentPayer?: PublicKey;
  now?: () => Date;
}

// What the platform can reclaim: unsold spots past their listing deadline, and live listings whose
// spots are all finished. Lamports come from chain, so an account already closed counts as 0.
export async function rentReport(deps: RentReportDeps) {
  const now = deps.now?.() ?? new Date();
  const openSpots = await deps.db
    .select({
      id: spots.id,
      index: spots.index,
      chainAddress: spots.chainAddress,
      vaultAddress: spots.vaultAddress,
      listingId: listings.id,
      listingTitle: listings.title,
      listingSlug: listings.slug,
      listingAddress: listings.chainAddress,
      deadline: listings.deadline,
    })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(eq(spots.state, "open"), eq(listings.state, "published"), lte(listings.deadline, now), isNotNull(spots.chainAddress)))
    .orderBy(asc(listings.deadline), asc(spots.index));

  const live = await deps.db
    .select({ id: listings.id, title: listings.title, slug: listings.slug, chainAddress: listings.chainAddress, spotState: spots.state })
    .from(listings)
    .leftJoin(spots, eq(spots.listingId, listings.id))
    .where(and(eq(listings.state, "published"), isNotNull(listings.chainAddress)));
  const byListing = new Map<string, { id: string; title: string; slug: string; chainAddress: string; done: boolean }>();
  for (const row of live) {
    const entry = byListing.get(row.id) ?? { id: row.id, title: row.title, slug: row.slug, chainAddress: row.chainAddress!, done: true };
    if (row.spotState && !terminalSpotStates.has(row.spotState)) entry.done = false;
    byListing.set(row.id, entry);
  }
  const closable = [...byListing.values()].filter((listing) => listing.done);

  const addresses = [...openSpots.flatMap((spot) => [spot.chainAddress!, spot.vaultAddress!]), ...closable.map((listing) => listing.chainAddress)];
  const lamports = addresses.length ? await deps.readLamports(addresses.map((address) => new PublicKey(address))) : [];
  const held = new Map(addresses.map((address, i) => [address, lamports[i] ?? 0]));

  // Rent goes back to each listing's own rent payer, which stays a former reviewer key until adopted.
  const listingAddresses = [...new Set([...openSpots.map((spot) => spot.listingAddress!), ...closable.map((listing) => listing.chainAddress)])];
  const payers = new Map<string, string | null>();
  if (deps.readListingRentPayers && deps.serverRentPayer && listingAddresses.length) {
    const read = await deps.readListingRentPayers(listingAddresses.map((address) => new PublicKey(address)));
    listingAddresses.forEach((address, i) => payers.set(address, read[i]?.toBase58() ?? null));
  }
  const server = deps.serverRentPayer?.toBase58() ?? null;
  const ownership = (listingAddress: string) => {
    const rentPayer = payers.has(listingAddress) ? payers.get(listingAddress)! : server;
    return { rentPayer, needsAdoption: Boolean(rentPayer && server && rentPayer !== server) };
  };

  const spotItems = openSpots.map(({ vaultAddress, listingAddress, ...spot }) => ({
    ...spot,
    lamports: (held.get(spot.chainAddress!) ?? 0) + (held.get(vaultAddress!) ?? 0),
    ...ownership(listingAddress!),
  }));
  const listingItems = closable.map(({ done: _done, ...listing }) => ({
    ...listing,
    lamports: held.get(listing.chainAddress) ?? 0,
    ...ownership(listing.chainAddress),
  }));
  const items = [...spotItems, ...listingItems];
  const reclaimableLamports = items.reduce((sum, item) => sum + item.lamports, 0);
  // Recorded to a former reviewer key: closing needs adopt_listing first, then the rent returns to the server.
  const needsAdoptionLamports = items.filter((item) => item.needsAdoption).reduce((sum, item) => sum + item.lamports, 0);
  return { spots: spotItems, listings: listingItems, reclaimableLamports, needsAdoptionLamports, serverRentPayer: server };
}
