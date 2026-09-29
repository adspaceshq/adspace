import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { privy } from "./auth.js";
import { loadKeypair } from "./keypair.js";
import { usdcMintFor } from "./payout.js";
import type { SolanaCluster } from "./config.js";
import type { SessionUser } from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const PLACE_BID_DISCRIMINATOR = Buffer.from([238, 77, 148, 91, 200, 151, 92, 146]);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync(
  [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
  ASSOCIATED_TOKEN_PROGRAM_ID,
)[0];

const u64 = (value: bigint) => {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
};

export interface AuctionBidExecutor {
  bid(spotId: string, bidder: SessionUser, amount: number): Promise<string>;
}

export class PrivyAuctionBidExecutor implements AuctionBidExecutor {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly mint: PublicKey;
  private readonly feePayer: Keypair;

  constructor(private readonly pool: Pool, rpcUrl: string, cluster: SolanaCluster, programId: string, walletPath: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.mint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT));
    this.feePayer = loadKeypair(walletPath);
  }

  async bid(spotId: string, bidder: SessionUser, amount: number): Promise<string> {
    if (!privy) throw httpError("Privy is not configured", 503);
    if (!bidder.walletAddress) throw httpError("bidder embedded wallet is not ready", 409);
    const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    if (!authorizationPrivateKey) throw httpError("Privy authorization key is not configured", 503);
    const result = await this.pool.query(
      `SELECT s.chain_address,s.chain_vault_address,s.status,s.current_bid,l.chain_address listing_address,
       l.mode,l.status listing_status,l.deadline,l.min_increment,l.double_up,
       (SELECT u.wallet_address FROM bids b JOIN users u ON u.id=b.bidder_user_id
        WHERE b.spot_id=s.id ORDER BY b.created_at DESC LIMIT 1) previous_wallet
       FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,
      [spotId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (!row.chain_address || !row.chain_vault_address || !row.listing_address) throw httpError("spot is not published on-chain", 409);
    if (row.mode !== "auction") throw httpError("fixed spots cannot receive bids", 409);
    if (row.listing_status !== "active" || !new Set(["open", "claimed"]).has(row.status)) throw httpError("spot is not open for bids", 409);
    if (new Date(row.deadline).getTime() <= Date.now()) throw httpError("auction has ended", 409);
    const current = Number(row.current_bid ?? 0);
    const minimum = current === 0 ? Number((await this.pool.query("SELECT price FROM spots WHERE id=$1", [spotId])).rows[0].price)
      : row.double_up ? current * 2 : current + Number(row.min_increment ?? 1);
    if (amount < minimum) throw httpError(`bid must be at least ${minimum}`, 400);
    const bidderKey = new PublicKey(bidder.walletAddress);
    if (row.previous_wallet && bidderKey.equals(new PublicKey(row.previous_wallet))) {
      throw httpError("this Privy wallet already holds the top bid; use a different account to outbid", 409);
    }
    const bidderAta = ata(bidderKey, this.mint);
    if (!(await this.connection.getAccountInfo(bidderAta, "confirmed"))) throw httpError("bidder devnet USDC account was not found", 409);
    const previousAta = row.previous_wallet ? ata(new PublicKey(row.previous_wallet), this.mint) : this.programId;
    if (row.previous_wallet && !(await this.connection.getAccountInfo(previousAta, "confirmed"))) {
      throw httpError("previous bidder USDC account was not found", 409);
    }
    const privyUser = await privy.users()._get(bidder.did);
    const wallet = privyUser.linked_accounts.find((account) => account.type === "wallet"
      && account.chain_type === "solana" && account.address === bidderKey.toBase58()
      && account.wallet_client_type === "privy");
    if (!wallet || !("id" in wallet) || !wallet.id) throw httpError("bidder Privy wallet was not found", 409);
    if (!("delegated" in wallet) || !wallet.delegated) throw httpError("bidder must enable gasless transactions first", 409);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: bidderKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(row.listing_address), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(row.chain_address), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(row.chain_vault_address), isSigner: false, isWritable: true },
        { pubkey: bidderAta, isSigner: false, isWritable: true },
        { pubkey: previousAta, isSigner: false, isWritable: Boolean(row.previous_wallet) },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([PLACE_BID_DISCRIMINATOR, u64(BigInt(Math.round(amount * 1_000_000)))]),
    });
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.feePayer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(instruction);
    const signedByBidder = await privy.wallets().solana().signTransaction(wallet.id, {
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
    });
    const signed = Transaction.from(Buffer.from(signedByBidder.signed_transaction, "base64"));
    signed.partialSign(this.feePayer);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    await this.pool.query("UPDATE spots SET chain_bid_signature=$2,updated_at=now() WHERE id=$1", [spotId, signature]);
    return signature;
  }
}
