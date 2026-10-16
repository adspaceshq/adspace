import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { Keypair } from "@solana/web3.js";
import type { ChainTxRequest, ChainTxResult } from "../../src/chain/runner.js";
import { keypairSigner, type TxSigner } from "../../src/chain/signers.js";
import type { Db } from "../../src/db/client.js";
import { chainTxs, listings, spots, users } from "../../src/db/schema.js";

export const USDC = 1_000_000n;

export async function seedUser(db: Db, prefix = "user") {
  const keypair = Keypair.generate();
  const handle = `${prefix}_${randomUUID().slice(0, 8)}`;
  const [user] = await db
    .insert(users)
    .values({ privyDid: `did:privy:${handle}`, handle, displayName: handle, walletAddress: keypair.publicKey.toBase58() })
    .returning();
  return { user, signer: keypairSigner(keypair) as TxSigner };
}

// A published listing with one spot; `funded` gives the spot a buyer.
export async function seedListing(
  db: Db,
  options: { deadline: Date; deliveryDueAt: Date; artworkDueAt?: Date; mode?: "fixed" | "auction"; funded?: boolean },
) {
  const seller = await seedUser(db, "seller");
  const mode = options.mode ?? "fixed";
  const [listing] = await db
    .insert(listings)
    .values({
      slug: `listing-${randomUUID()}`,
      sellerId: seller.user.id,
      surface: "laptop",
      title: "seeded listing",
      mode,
      state: "published",
      deadline: options.deadline,
      artworkDueAt: options.artworkDueAt ?? options.deadline,
      deliveryDueAt: options.deliveryDueAt,
      minIncrement: mode === "auction" ? 10n * USDC : 0n,
      feeBps: mode === "auction" ? 250 : 500,
      upliftFeeBps: mode === "auction" ? 2000 : 0,
      maxFeeBps: mode === "auction" ? 1000 : 500,
      chainAddress: Keypair.generate().publicKey.toBase58(),
      sellerWallet: seller.user.walletAddress,
    })
    .returning();
  const buyer = options.funded ? await seedUser(db, "buyer") : undefined;
  const [spot] = await db
    .insert(spots)
    .values({
      listingId: listing.id,
      index: 0,
      price: 100n * USDC,
      layout: { x: 0, y: 0, w: 10 },
      chainAddress: Keypair.generate().publicKey.toBase58(),
      vaultAddress: Keypair.generate().publicKey.toBase58(),
      ...(buyer
        ? { state: "funded" as const, buyerId: buyer.user.id, buyerWallet: buyer.user.walletAddress!, amount: 100n * USDC }
        : {}),
    })
    .returning();
  return { seller, buyer, listing, spot };
}

// Mirrors runner idempotency: a confirmed key is returned instead of re-sent.
export function fakeRunTx(db: Db, sent: ChainTxRequest[], failWith?: () => Error | undefined) {
  return async (request: ChainTxRequest): Promise<ChainTxResult> => {
    const [existing] = await db.select().from(chainTxs).where(eq(chainTxs.idempotencyKey, request.idempotencyKey));
    if (existing?.status === "confirmed") return { chainTxId: existing.id, signature: existing.signature! };
    const failure = failWith?.();
    if (failure) throw failure;
    sent.push(request);
    const [row] = await db
      .insert(chainTxs)
      .values({
        op: request.op,
        idempotencyKey: request.idempotencyKey,
        spotId: request.spotId,
        status: "confirmed",
        signature: `sig-${randomUUID()}`,
        confirmedAt: new Date(),
      })
      .returning();
    return { chainTxId: row.id, signature: row.signature! };
  };
}
