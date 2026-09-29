import { createHash } from "node:crypto";
import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import type { Listing } from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CREATE_LISTING_DISCRIMINATOR = Buffer.from([18, 168, 45, 24, 191, 31, 117, 54]);
const ADD_SPOT_DISCRIMINATOR = Buffer.from([19, 222, 144, 73, 51, 28, 136, 181]);

export interface ReviewPolicy {
  feeBps: number;
  upliftFeeBps: number;
  maxFeeBps: number;
  reviewWindowSeconds: number;
  deliveryDeadline: string;
}

export interface ListingAddresses {
  listing: PublicKey;
  spots: Array<{ spot: PublicKey; vault: PublicKey }>;
}

const seed = (value: string) => Buffer.from(value, "utf8");

function integer(value: number | bigint, bytes: 2 | 4 | 8, signed = false): Buffer {
  const data = Buffer.alloc(bytes);
  if (bytes === 2) data.writeUInt16LE(Number(value));
  else if (bytes === 4) data.writeUInt32LE(Number(value));
  else if (signed) data.writeBigInt64LE(BigInt(value));
  else data.writeBigUInt64LE(BigInt(value));
  return data;
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([integer(bytes.length, 4), bytes]);
}

function unixSeconds(value: string): bigint {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) throw Object.assign(new Error("invalid listing timestamp"), { status: 400 });
  return BigInt(Math.floor(timestamp / 1000));
}

function checkedU16(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw Object.assign(new Error(`${name} must be between 0 and 10000`), { status: 400 });
  }
  return value;
}

export function slugHash(slug: string): Buffer {
  return createHash("sha256").update(slug).digest().subarray(0, 16);
}

export function deriveListingAddresses(programId: PublicKey, seller: PublicKey, slug: string, spotCount: number): ListingAddresses {
  const listing = PublicKey.findProgramAddressSync(
    [seed("listing"), seller.toBuffer(), slugHash(slug)],
    programId,
  )[0];
  const spots = Array.from({ length: spotCount }, (_, index) => {
    if (index > 255) throw Object.assign(new Error("too many spots"), { status: 400 });
    const spot = PublicKey.findProgramAddressSync([seed("spot"), listing.toBuffer(), Buffer.from([index])], programId)[0];
    const vault = PublicKey.findProgramAddressSync([seed("vault"), spot.toBuffer()], programId)[0];
    return { spot, vault };
  });
  return { listing, spots };
}

export function createListingInstructions(input: {
  programId: PublicKey;
  usdcMint: PublicKey;
  seller: PublicKey;
  reviewer: PublicKey;
  listing: Listing;
  metadataUri: string;
  policy: ReviewPolicy;
}): { addresses: ListingAddresses; instructions: TransactionInstruction[] } {
  const { programId, usdcMint, seller, reviewer, listing, metadataUri, policy } = input;
  const feeBps = checkedU16("feeBps", policy.feeBps);
  const upliftFeeBps = checkedU16("upliftFeeBps", policy.upliftFeeBps);
  const maxFeeBps = checkedU16("maxFeeBps", policy.maxFeeBps);
  const addresses = deriveListingAddresses(programId, seller, listing.slug, listing.spots.length);
  const config = PublicKey.findProgramAddressSync([seed("config")], programId)[0];
  const reviewAuthority = PublicKey.findProgramAddressSync(
    [seed("review_authority"), config.toBuffer()],
    programId,
  )[0];
  const artworkClose = listing.artworkClose || listing.deadline;
  const minIncrementValue = listing.minIncrement ?? (listing.mode === "auction" && !listing.doubleUp ? 1 : 0);
  const minIncrement = BigInt(Math.round(minIncrementValue * 1_000_000));
  const data = Buffer.concat([
    CREATE_LISTING_DISCRIMINATOR,
    slugHash(listing.slug),
    borshString(metadataUri),
    Buffer.from([listing.mode === "auction" ? 1 : 0]),
    integer(unixSeconds(listing.deadline), 8, true),
    integer(unixSeconds(artworkClose), 8, true),
    integer(unixSeconds(policy.deliveryDeadline), 8, true),
    integer(policy.reviewWindowSeconds, 8, true),
    integer(minIncrement, 8),
    Buffer.from([listing.doubleUp ? 1 : 0]),
    integer(feeBps, 2),
    integer(upliftFeeBps, 2),
    integer(maxFeeBps, 2),
  ]);
  const instructions = [new TransactionInstruction({
    programId,
    keys: [
      { pubkey: seller, isSigner: true, isWritable: true },
      { pubkey: reviewer, isSigner: true, isWritable: false },
      { pubkey: addresses.listing, isSigner: false, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: reviewAuthority, isSigner: false, isWritable: false },
      { pubkey: usdcMint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  })];
  listing.spots.forEach((spot, index) => {
    const address = addresses.spots[index];
    instructions.push(new TransactionInstruction({
      programId,
      keys: [
        { pubkey: seller, isSigner: true, isWritable: true },
        { pubkey: addresses.listing, isSigner: false, isWritable: true },
        { pubkey: address.spot, isSigner: false, isWritable: true },
        { pubkey: address.vault, isSigner: false, isWritable: true },
        { pubkey: usdcMint, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([ADD_SPOT_DISCRIMINATOR, integer(BigInt(Math.round(spot.price * 1_000_000)), 8)]),
    }));
  });
  return { addresses, instructions };
}
