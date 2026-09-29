import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY,
  Transaction, TransactionInstruction,
} from "@solana/web3.js";
import { privy } from "./auth.js";
import type { Listing, SessionUser } from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CREATE_LISTING = Buffer.from([18, 168, 45, 24, 191, 31, 117, 54]);
const ADD_SPOT = Buffer.from([19, 222, 144, 73, 51, 28, 136, 181]);
const LISTING_SPACE = 375;
const SPOT_SPACE = 196;
const TOKEN_ACCOUNT_SPACE = 165;

const seed = (value: string) => Buffer.from(value);
const u16 = (value: number) => { const b=Buffer.alloc(2); b.writeUInt16LE(value); return b; };
const u32 = (value: number) => { const b=Buffer.alloc(4); b.writeUInt32LE(value); return b; };
const u64 = (value: bigint) => { const b=Buffer.alloc(8); b.writeBigUInt64LE(value); return b; };
const i64 = (value: bigint) => { const b=Buffer.alloc(8); b.writeBigInt64LE(value); return b; };
const usdc = (value: number) => BigInt(Math.round(value * 1_000_000));

function reviewerKeypair(): Keypair {
  const inline = process.env.ADSPACES_REVIEWER_KEYPAIR;
  const path = process.env.ADSPACES_REVIEWER_KEYPAIR_PATH;
  if (!inline && !path) throw Object.assign(new Error("ADSPACES_REVIEWER_KEYPAIR or ADSPACES_REVIEWER_KEYPAIR_PATH is required"), { status: 503 });
  const raw = inline ?? readFileSync(path!, "utf8");
  const secret = JSON.parse(raw) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(secret));
  const expected = process.env.ADSPACES_REVIEWER_WALLET;
  if (expected && keypair.publicKey.toBase58() !== expected) throw Object.assign(new Error("reviewer keypair does not match ADSPACES_REVIEWER_WALLET"), { status: 503 });
  return keypair;
}

export class PrivyListingPublisher {
  private connection: Connection;
  private programId: PublicKey;
  private mint: PublicKey;

  constructor(rpcUrl: string, programId: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.mint = new PublicKey(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
  }

  async publish(listing: Listing, sellerUser: SessionUser): Promise<void> {
    if (!privy) throw Object.assign(new Error("Privy is not configured"), { status: 503 });
    if (!sellerUser.walletAddress) throw Object.assign(new Error("seller Privy wallet is missing"), { status: 409 });
    const authorizationKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    if (!authorizationKey) throw Object.assign(new Error("Privy authorization key is not configured"), { status: 503 });
    const reviewer = reviewerKeypair();
    const seller = new PublicKey(sellerUser.walletAddress);
    const privyUser = await privy.users()._get(sellerUser.did);
    const wallet = privyUser.linked_accounts.find((a) => a.type === "wallet" && a.chain_type === "solana" && a.address === seller.toBase58() && a.wallet_client_type === "privy");
    if (!wallet || !("id" in wallet) || !wallet.id || !("delegated" in wallet) || !wallet.delegated) {
      throw Object.assign(new Error("Enable gasless transactions before accepting terms"), { status: 409 });
    }
    const slugHash = createHash("sha256").update(listing.slug).digest().subarray(0, 16);
    const [listingPda] = PublicKey.findProgramAddressSync([seed("listing"), seller.toBuffer(), slugHash], this.programId);
    const [config] = PublicKey.findProgramAddressSync([seed("config")], this.programId);
    const [reviewAuthority] = PublicKey.findProgramAddressSync([seed("review_authority"), config.toBuffer()], this.programId);
    if (!(await this.connection.getAccountInfo(listingPda))) {
      const deadline = Math.floor(new Date(listing.deadline).getTime()/1000);
      const requestedArtwork = Math.floor(new Date(listing.artworkClose || listing.deadline).getTime()/1000);
      const artwork = Math.max(deadline, requestedArtwork);
      const delivery = listing.deliveryDeadline ? Math.floor(new Date(listing.deliveryDeadline).getTime()/1000) : artwork + Number(process.env.ADSPACES_DELIVERY_WINDOW_SECONDS ?? 259200);
      const reviewWindow = (listing.settlementWindowHours ?? 48) * 3600;
      const fee = listing.platformFeeBps ?? Number(process.env.ADSPACES_FEE_BPS ?? 250);
      const uplift = listing.mode === "fixed" ? 0 : (listing.upliftFeeBps ?? Number(process.env.ADSPACES_UPLIFT_FEE_BPS ?? 1000));
      const maxFee = listing.mode === "fixed" ? fee : (listing.maxFeeBps ?? Number(process.env.ADSPACES_MAX_FEE_BPS ?? 1000));
      const metadata = `${process.env.FRONTEND_URL ?? "http://localhost:3000"}/listings/${listing.slug}`;
      const metadataBytes = Buffer.from(metadata);
      const data = Buffer.concat([CREATE_LISTING, slugHash, u32(metadataBytes.length), metadataBytes,
        Buffer.from([listing.mode === "fixed" ? 0 : 1]), i64(BigInt(deadline)), i64(BigInt(artwork)), i64(BigInt(delivery)), i64(BigInt(reviewWindow)),
        u64(usdc(listing.mode === "auction" ? (listing.minIncrement ?? 1) : 0)), Buffer.from([listing.doubleUp ? 1 : 0]), u16(fee), u16(uplift), u16(maxFee)]);
      const ix = new TransactionInstruction({ programId: this.programId, data, keys: [
        {pubkey:seller,isSigner:true,isWritable:true},{pubkey:reviewer.publicKey,isSigner:true,isWritable:false},{pubkey:listingPda,isSigner:false,isWritable:true},
        {pubkey:config,isSigner:false,isWritable:false},{pubkey:reviewAuthority,isSigner:false,isWritable:false},{pubkey:this.mint,isSigner:false,isWritable:false},
        {pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
      ]});
      await this.send(wallet.id, seller, reviewer, [ix], await this.connection.getMinimumBalanceForRentExemption(LISTING_SPACE), authorizationKey);
    }
    for (let index=0; index<listing.spots.length; index++) {
      const [spot] = PublicKey.findProgramAddressSync([seed("spot"), listingPda.toBuffer(), Buffer.from([index])], this.programId);
      if (await this.connection.getAccountInfo(spot)) continue;
      const [vault] = PublicKey.findProgramAddressSync([seed("vault"), spot.toBuffer()], this.programId);
      const ix = new TransactionInstruction({ programId:this.programId, data:Buffer.concat([ADD_SPOT,u64(usdc(listing.spots[index].price))]), keys:[
        {pubkey:seller,isSigner:true,isWritable:true},{pubkey:listingPda,isSigner:false,isWritable:true},{pubkey:spot,isSigner:false,isWritable:true},
        {pubkey:vault,isSigner:false,isWritable:true},{pubkey:this.mint,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},
        {pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false},{pubkey:SYSVAR_RENT_PUBKEY,isSigner:false,isWritable:false},
      ]});
      const rent = await this.connection.getMinimumBalanceForRentExemption(SPOT_SPACE) + await this.connection.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_SPACE);
      await this.send(wallet.id, seller, reviewer, [ix], rent, authorizationKey);
    }
  }

  private async send(walletId: string, seller: PublicKey, reviewer: Keypair, instructions: TransactionInstruction[], rent: number, authorizationKey: string): Promise<void> {
    const balance = await this.connection.getBalance(seller, "confirmed");
    const tx = new Transaction();
    if (balance < rent) tx.add(SystemProgram.transfer({ fromPubkey: reviewer.publicKey, toPubkey: seller, lamports: rent-balance }));
    tx.add(...instructions);
    tx.feePayer = reviewer.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash("confirmed")).blockhash;
    tx.partialSign(reviewer);
    await privy!.wallets().solana().signAndSendTransaction(walletId, {
      transaction: tx.serialize({requireAllSignatures:false,verifySignatures:false}),
      caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1", sponsor:false,
      authorization_context:{authorization_private_keys:[authorizationKey]},
    });
  }
}
