import { AnchorProvider, Program, type Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, type Transaction, type VersionedTransaction } from "@solana/web3.js";
import { ADSPACES_IDL, type Adspaces } from "./idl/adspaces.js";

export type AdspacesProgram = Program<Adspaces>;

// Instruction builder only; the wallet never signs, signing happens in the runner.
const readOnlyWallet: Wallet = {
  publicKey: Keypair.generate().publicKey,
  payer: Keypair.generate(),
  signTransaction: async <T extends Transaction | VersionedTransaction>(): Promise<T> => {
    throw new Error("read-only provider cannot sign");
  },
  signAllTransactions: async <T extends Transaction | VersionedTransaction>(): Promise<T[]> => {
    throw new Error("read-only provider cannot sign");
  },
};

export function createProgram(connection: Connection): AdspacesProgram {
  const provider = new AnchorProvider(connection, readOnlyWallet, { commitment: "confirmed" });
  return new Program<Adspaces>(ADSPACES_IDL, provider);
}

const seed = (value: string) => Buffer.from(value);

export function pdas(programId: PublicKey) {
  const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, programId)[0];
  return {
    config: () => find(seed("config")),
    reviewAuthority: (config: PublicKey) => find(seed("review_authority"), config.toBuffer()),
    listing: (seller: PublicKey, slugHash: Uint8Array) => find(seed("listing"), seller.toBuffer(), Buffer.from(slugHash)),
    spot: (listing: PublicKey, index: number) => find(seed("spot"), listing.toBuffer(), Buffer.from([index])),
    vault: (spot: PublicKey) => find(seed("vault"), spot.toBuffer()),
    proof: (spot: PublicKey) => find(seed("proof"), spot.toBuffer()),
    dispute: (spot: PublicKey) => find(seed("dispute"), spot.toBuffer()),
  };
}

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ATA_PROGRAM_ID)[0];
}

export { TOKEN_PROGRAM_ID, ATA_PROGRAM_ID };
