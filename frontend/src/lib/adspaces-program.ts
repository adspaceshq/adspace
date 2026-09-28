import { PublicKey } from '@solana/web3.js';

const DEFAULT_PROGRAM_ID = '6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW';
const DEFAULT_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

export const ADSPACES_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ADSPACES_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
);
export const ADSPACES_USDC_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_ADSPACES_USDC_MINT ?? DEFAULT_USDC_MINT,
);
export const ADSPACES_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const ADSPACES_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet';

export const instructionDiscriminators = {
  acceptConfigAuthority: [138, 34, 130, 16, 252, 207, 24, 90],
  addSpot: [19, 222, 144, 73, 51, 28, 136, 181],
  cancelConfigAuthority: [13, 66, 89, 171, 84, 217, 93, 155],
  claimSpot: [89, 18, 139, 11, 246, 170, 6, 173],
  closeSpot: [120, 210, 73, 225, 51, 123, 54, 248],
  createListing: [18, 168, 45, 24, 191, 31, 117, 54],
  initializeConfig: [208, 127, 21, 1, 194, 190, 196, 70],
  initializeReviewAuthority: [54, 226, 205, 48, 70, 91, 220, 184],
  placeBid: [238, 77, 148, 91, 200, 151, 92, 146],
  proposeConfigAuthority: [31, 229, 9, 231, 45, 153, 123, 235],
  raiseDispute: [41, 243, 1, 51, 150, 95, 246, 73],
  refundSpot: [247, 84, 138, 122, 229, 147, 248, 47],
  resolveDispute: [231, 6, 202, 6, 96, 103, 12, 230],
  submitProof: [54, 241, 46, 84, 4, 212, 46, 94],
  updateConfig: [29, 158, 252, 191, 10, 83, 219, 99],
  updateReviewAuthority: [243, 170, 135, 199, 126, 86, 85, 242],
  withdrawSeller: [36, 53, 86, 71, 125, 229, 115, 98],
} as const;

const seed = (value: string) => new TextEncoder().encode(value);

export function configPda(): PublicKey {
  return PublicKey.findProgramAddressSync([seed('config')], ADSPACES_PROGRAM_ID)[0];
}

export function reviewAuthorityPda(): PublicKey {
  return PublicKey.findProgramAddressSync([seed('review_authority')], ADSPACES_PROGRAM_ID)[0];
}

export function authorityTransferPda(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed('authority_transfer'), configPda().toBuffer()],
    ADSPACES_PROGRAM_ID,
  )[0];
}

export async function listingPda(seller: PublicKey, slug: string): Promise<PublicKey> {
  const slugHash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(slug)),
  );
  return PublicKey.findProgramAddressSync(
    [seed('listing'), seller.toBuffer(), slugHash],
    ADSPACES_PROGRAM_ID,
  )[0];
}

export function spotPda(listing: PublicKey, index: number): PublicKey {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error('spot index must be an unsigned byte');
  }
  return PublicKey.findProgramAddressSync(
    [seed('spot'), listing.toBuffer(), Uint8Array.of(index)],
    ADSPACES_PROGRAM_ID,
  )[0];
}

export function vaultPda(spot: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed('vault'), spot.toBuffer()],
    ADSPACES_PROGRAM_ID,
  )[0];
}

export function proofPda(spot: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed('proof'), spot.toBuffer()],
    ADSPACES_PROGRAM_ID,
  )[0];
}

export function disputePda(spot: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [seed('dispute'), spot.toBuffer()],
    ADSPACES_PROGRAM_ID,
  )[0];
}
