import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';

const DEFAULT_PROGRAM_ID = '6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW';
const paymentMint = process.env.NEXT_PUBLIC_ADSPACES_PAYMENT_MINT;
if (!paymentMint) throw new Error('NEXT_PUBLIC_ADSPACES_PAYMENT_MINT is required');

export const ADSPACES_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_ADSPACES_PROGRAM_ID ?? DEFAULT_PROGRAM_ID,
);
export const ADSPACES_USDC_MINT = new PublicKey(
  paymentMint,
);
export const ADSPACES_RPC_URL =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
export const ADSPACES_CLUSTER = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? 'devnet';

const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

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

function associatedTokenAddress(owner: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), ADSPACES_USDC_MINT.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export async function embeddedUsdcBalance(ownerAddress: string): Promise<number> {
  const connection = new Connection(ADSPACES_RPC_URL, 'confirmed');
  const balance = await connection
    .getTokenAccountBalance(associatedTokenAddress(new PublicKey(ownerAddress)), 'confirmed')
    .catch(() => null);
  return balance?.value.uiAmount ?? 0;
}

function u64(value: bigint): Uint8Array {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, value, true);
  return data;
}

export async function withdrawEmbeddedUsdc(
  wallet: ConnectedStandardSolanaWallet,
  destinationAddress: string,
  amount: number,
  sendTransaction: (input: {
    transaction: Uint8Array;
    wallet: ConnectedStandardSolanaWallet;
    chain: `solana:${string}`;
    options: {
      commitment: 'confirmed';
      preflightCommitment: 'confirmed';
      sponsor: true;
      uiOptions: { showWalletUIs: false };
    };
  }) => Promise<{ signature: Uint8Array }>,
): Promise<string> {
  const owner = new PublicKey(wallet.address);
  const destination = new PublicKey(destinationAddress);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 1_000_000) !== amount * 1_000_000) {
    throw new Error('Enter a valid USDC amount with no more than 6 decimals');
  }
  if (owner.equals(destination)) throw new Error('Destination must be a different wallet');

  const connection = new Connection(ADSPACES_RPC_URL, 'confirmed');
  const sourceAta = associatedTokenAddress(owner);
  const destinationAta = associatedTokenAddress(destination);
  const source = await connection.getTokenAccountBalance(sourceAta, 'confirmed').catch(() => null);
  const amountBaseUnits = BigInt(Math.round(amount * 1_000_000));
  if (!source || BigInt(source.value.amount) < amountBaseUnits) throw new Error('Insufficient USDC balance');

  const transaction = new Transaction();
  if (!(await connection.getAccountInfo(destinationAta, 'confirmed'))) {
    transaction.add(new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: destinationAta, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: false },
        { pubkey: ADSPACES_USDC_MINT, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Uint8Array.of(1) as unknown as Buffer,
    }));
  }
  transaction.add(new TransactionInstruction({
    programId: TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: ADSPACES_USDC_MINT, isSigner: false, isWritable: false },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: new Uint8Array([12, ...u64(amountBaseUnits), 6]) as unknown as Buffer,
  }));
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.feePayer = owner;
  transaction.recentBlockhash = latest.blockhash;
  const result = await sendTransaction({
    transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
    wallet,
    chain: `solana:${ADSPACES_CLUSTER}`,
    options: {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
      sponsor: true,
      uiOptions: { showWalletUIs: false },
    },
  });
  return encodeBase58(result.signature);
}

function encodeBase58(bytes: Uint8Array): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) digits.push(0);
  return digits.reverse().map((digit) => alphabet[digit]).join('');
}
