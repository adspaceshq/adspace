import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { privy } from "./auth.js";
import { usdcMintFor } from "./payout.js";
import type { SolanaCluster } from "./config.js";
import type { SessionUser } from "./types.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const CLAIM_SPOT_DISCRIMINATOR = Buffer.from([89, 18, 139, 11, 246, 170, 6, 173]);

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

export interface FixedClaimExecutor {
  claim(spotId: string, buyer: SessionUser): Promise<string>;
}

export class PrivyFixedClaimExecutor implements FixedClaimExecutor {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly mint: PublicKey;
  private readonly feePayer: Keypair;

  constructor(
    private readonly pool: Pool,
    rpcUrl: string,
    cluster: SolanaCluster,
    programId: string,
    reviewerWalletPath: string,
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.mint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT));
    this.feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(reviewerWalletPath, "utf8"))));
  }

  async claim(spotId: string, buyer: SessionUser): Promise<string> {
    if (!privy) throw httpError("Privy is not configured", 503);
    if (!buyer.walletAddress) throw httpError("buyer embedded wallet is not ready", 409);
    const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    if (!authorizationPrivateKey) throw httpError("Privy authorization key is not configured", 503);
    const result = await this.pool.query(
      `SELECT s.chain_address,s.chain_vault_address,s.status,l.chain_address listing_address,
       l.mode,l.status listing_status,l.deadline
       FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,
      [spotId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (!row.chain_address || !row.chain_vault_address || !row.listing_address) throw httpError("spot is not published on-chain", 409);
    if (row.mode !== "fixed") throw httpError("auction spots require a bid", 409);
    if (row.listing_status !== "active" || row.status !== "open") throw httpError("spot is not open", 409);
    if (new Date(row.deadline).getTime() <= Date.now()) throw httpError("listing has ended", 409);
    const buyerKey = new PublicKey(buyer.walletAddress);
    const buyerAta = associatedTokenAddress(buyerKey, this.mint);
    if (!(await this.connection.getAccountInfo(buyerAta, "confirmed"))) {
      throw httpError("buyer devnet USDC account was not found", 409);
    }
    const privyUser = await privy.users()._get(buyer.did);
    const wallet = privyUser.linked_accounts.find((account) =>
      account.type === "wallet" && account.chain_type === "solana"
      && account.address === buyerKey.toBase58() && account.wallet_client_type === "privy",
    );
    if (!wallet || !("id" in wallet) || !wallet.id) throw httpError("buyer Privy wallet was not found", 409);
    if (!("delegated" in wallet) || !wallet.delegated) throw httpError("buyer must enable gasless transactions first", 409);
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: buyerKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(row.listing_address), isSigner: false, isWritable: false },
        { pubkey: new PublicKey(row.chain_address), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(row.chain_vault_address), isSigner: false, isWritable: true },
        { pubkey: buyerAta, isSigner: false, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: CLAIM_SPOT_DISCRIMINATOR,
    });
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.feePayer.publicKey, ...latest }).add(instruction);
    const signedByBuyer = await privy.wallets().solana().signTransaction(wallet.id, {
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
    });
    const signed = Transaction.from(Buffer.from(signedByBuyer.signed_transaction, "base64"));
    signed.partialSign(this.feePayer);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    await this.pool.query("UPDATE spots SET chain_claim_signature=$2,updated_at=now() WHERE id=$1", [spotId, signature]);
    return signature;
  }
}
