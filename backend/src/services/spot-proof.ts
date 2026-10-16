import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { listingPosts, listings, spotEvents, spotProofPosts, spots, users } from "../db/schema.js";
import { nextSpotState } from "../domain/spot-state.js";
import { pdas, type AdspacesProgram } from "../chain/program.js";
import type { ChainTxRequest, ChainTxResult } from "../chain/runner.js";
import { cosigners, type TxSigner } from "../chain/signers.js";
import { formatUtc } from "./notifications.js";

export class ProofError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface ProofDeps {
  db: Db;
  program: AdspacesProgram;
  feePayer: TxSigner;
  // Pays the proof account's rent; must be the listing's on-chain rent payer, which signs.
  rentPayer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  listingBaseUrl: string;
  now?: () => Date;
}

const MAX_PROOF_POSTS = 10;
const PROOF_URI_MAX_BYTES = 200;

// Deterministic: same posts in any order give the same hash.
export function proofHash(spotId: string, posts: Array<{ id: string; url: string | null; body: string }>): Buffer {
  const canonical = posts
    .map((post) => `${post.id}|${post.url ?? ""}|${post.body}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(`adspaces-proof-v1\n${spotId}\n${canonical}`).digest();
}

// The creator tags posts as delivery proof for a spot; their hash is recorded on-chain.
// The program accepts proof only from artwork close (when the sponsor's artwork is final) until the
// delivery deadline; anti-snipe extensions never move the deadline past artwork close.
export async function submitSpotProof(deps: ProofDeps, sellerId: string, seller: TxSigner, spotId: string, postIds: string[]) {
  const now = deps.now?.() ?? new Date();
  const ids = [...new Set(postIds)];
  if (ids.length === 0 || ids.length > MAX_PROOF_POSTS) throw new ProofError(`pick 1-${MAX_PROOF_POSTS} posts as proof`);

  const [row] = await deps.db
    .select({ spot: spots, listing: listings, handle: users.handle })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(eq(spots.id, spotId));
  if (!row) throw new ProofError("spot not found", 404);
  const { spot, listing } = row;
  if (listing.sellerId !== sellerId) throw new ProofError("only the creator can submit proof", 403);
  if (spot.state !== "funded") throw new ProofError("this spot isn't waiting for delivery", 409);
  if (now < listing.artworkDueAt) throw new ProofError(`proof opens at ${formatUtc(listing.artworkDueAt)}, when the artwork window closes`, 409);
  if (now >= listing.deliveryDueAt) throw new ProofError("the delivery deadline has passed", 409);
  if (!listing.chainAddress || !spot.chainAddress) throw new ProofError("spot is not published on-chain", 409);
  if (listing.sellerWallet !== seller.publicKey.toBase58()) throw new ProofError("submit proof with your listing wallet", 409);

  const posts = await deps.db
    .select({ id: listingPosts.id, url: listingPosts.url, body: listingPosts.body })
    .from(listingPosts)
    .where(and(inArray(listingPosts.id, ids), eq(listingPosts.listingId, listing.id), isNull(listingPosts.deletedAt)));
  if (posts.length !== ids.length) throw new ProofError("proof posts must be live posts on this listing");

  const hash = proofHash(spot.id, posts);
  const uri = `${deps.listingBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(row.handle)}/${encodeURIComponent(listing.slug)}#spot-${spot.index + 1}`;
  if (Buffer.byteLength(uri) > PROOF_URI_MAX_BYTES) throw new ProofError("proof link is too long", 500);

  const spotKey = new PublicKey(spot.chainAddress);
  const instruction = await deps.program.methods
    .submitProof(Array.from(hash), uri)
    .accountsStrict({
      seller: seller.publicKey,
      rentPayer: deps.rentPayer.publicKey,
      listing: new PublicKey(listing.chainAddress),
      spot: spotKey,
      proof: pdas(deps.program.programId).proof(spotKey),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const tx = await deps.runTx({
    op: "submit_proof",
    idempotencyKey: `proof:${spot.id}`,
    listingId: listing.id,
    spotId: spot.id,
    actorId: sellerId,
    instructions: [instruction],
    feePayer: deps.feePayer,
    signers: cosigners(deps.feePayer, seller, deps.rentPayer),
  });

  return deps.db.transaction(async (trx) => {
    const to = nextSpotState("funded", "proof_submitted");
    const [updated] = await trx
      .update(spots)
      .set({ state: to, proofHash: hash.toString("hex"), proofSubmittedAt: now, updatedAt: now })
      .where(and(eq(spots.id, spot.id), eq(spots.state, "funded")))
      .returning();
    if (!updated) throw new ProofError("spot changed while proof was confirming; reconciling", 500);
    await trx.insert(spotProofPosts).values(ids.map((postId) => ({ spotId: spot.id, postId })));
    await trx.insert(spotEvents).values({
      spotId: spot.id,
      fromState: "funded",
      toState: to,
      type: "proof_submitted",
      actorId: sellerId,
      chainTxId: tx.chainTxId,
      data: { postIds: ids, proofHash: hash.toString("hex") },
    });
    return { spot: updated, signature: tx.signature };
  });
}
