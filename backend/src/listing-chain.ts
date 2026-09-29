import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { privy } from "./auth.js";
import { createListingInstructions, type ReviewPolicy } from "./adspaces-program.js";
import type { SolanaCluster } from "./config.js";
import { loadKeypair } from "./keypair.js";
import { usdcMintFor } from "./payout.js";
import type { Listing, SessionUser } from "./types.js";

export interface ListingPublisher {
  publish(listing: Listing, seller: SessionUser, policy: ReviewPolicy): Promise<ChainPublication>;
}

export interface ChainPublication {
  listingAddress: string;
  signatures: string[];
  spots: Array<{ id: string; address: string; vaultAddress: string; signature?: string }>;
}

export class PostgresSellerIdentityRepository {
  constructor(private readonly pool: Pool) {}

  async get(userId: string): Promise<SessionUser | undefined> {
    const result = await this.pool.query(
      `SELECT id,privy_did,x_handle,x_user_id,display_name,avatar_url,email,wallet_address
       FROM users WHERE id=$1`,
      [userId],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      did: row.privy_did,
      handle: row.x_handle,
      name: row.display_name ?? undefined,
      avatar: row.avatar_url ?? undefined,
      email: row.email ?? undefined,
      walletAddress: row.wallet_address ?? undefined,
      hasX: Boolean(row.x_user_id),
    } : undefined;
  }
}

export class PrivyListingPublisher implements ListingPublisher {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly usdcMint: PublicKey;
  private readonly reviewer: Keypair;

  constructor(
    rpcUrl: string,
    private readonly cluster: SolanaCluster,
    programId: string,
    reviewerWalletPath: string,
    private readonly metadataBaseUrl: string,
  ) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.usdcMint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT));
    this.reviewer = loadKeypair(reviewerWalletPath);
  }

  async publish(listing: Listing, seller: SessionUser, policy: ReviewPolicy): Promise<ChainPublication> {
    if (!privy) throw Object.assign(new Error("Privy is not configured"), { status: 503 });
    if (!seller.walletAddress) throw Object.assign(new Error("seller embedded wallet is not ready"), { status: 409 });
    const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    if (!authorizationPrivateKey) throw Object.assign(new Error("Privy authorization key is not configured"), { status: 503 });
    const sellerKey = new PublicKey(seller.walletAddress);
    const wallet = await this.delegatedWallet(seller, sellerKey);
    const metadataUri = `${this.metadataBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(listing.sellerHandle)}/${encodeURIComponent(listing.slug)}`;
    const built = createListingInstructions({
      programId: this.programId,
      usdcMint: this.usdcMint,
      seller: sellerKey,
      reviewer: this.reviewer.publicKey,
      listing,
      metadataUri,
      policy,
    });
    await this.assertReviewerAuthority();
    await this.ensureSellerFunding(sellerKey);
    const signatures: string[] = [];
    const spotSignatures = new Map<number, string>();
    if (!(await this.connection.getAccountInfo(built.addresses.listing, "confirmed"))) {
      signatures.push(await this.send(wallet.id, built.instructions[0], authorizationPrivateKey));
    }
    for (let index = 0; index < built.addresses.spots.length; index += 1) {
      if (!(await this.connection.getAccountInfo(built.addresses.spots[index].spot, "confirmed"))) {
        const signature = await this.send(wallet.id, built.instructions[index + 1], authorizationPrivateKey);
        signatures.push(signature);
        spotSignatures.set(index, signature);
      }
    }
    return {
      listingAddress: built.addresses.listing.toBase58(),
      signatures,
      spots: built.addresses.spots.map((address, index) => ({
        id: listing.spots[index].id,
        address: address.spot.toBase58(),
        vaultAddress: address.vault.toBase58(),
        signature: spotSignatures.get(index),
      })),
    };
  }

  private async delegatedWallet(user: SessionUser, address: PublicKey): Promise<{ id: string }> {
    const privyUser = await privy!.users()._get(user.did);
    const wallet = privyUser.linked_accounts.find((account) =>
      account.type === "wallet"
      && account.chain_type === "solana"
      && account.address === address.toBase58()
      && account.wallet_client_type === "privy",
    );
    if (!wallet || !("id" in wallet) || !wallet.id) {
      throw Object.assign(new Error("seller Privy embedded wallet was not found"), { status: 409 });
    }
    if (!("delegated" in wallet) || !wallet.delegated) {
      throw Object.assign(new Error("seller must enable gasless transactions first"), { status: 409 });
    }
    return { id: wallet.id };
  }

  private async assertReviewerAuthority(): Promise<void> {
    const config = PublicKey.findProgramAddressSync([Buffer.from("config")], this.programId)[0];
    const authority = PublicKey.findProgramAddressSync(
      [Buffer.from("review_authority"), config.toBuffer()],
      this.programId,
    )[0];
    const account = await this.connection.getAccountInfo(authority, "confirmed");
    if (!account || account.data.length < 72) throw Object.assign(new Error("on-chain review authority is not initialized"), { status: 503 });
    const configured = new PublicKey(account.data.subarray(40, 72));
    if (!configured.equals(this.reviewer.publicKey)) {
      throw Object.assign(new Error("reviewer wallet does not match the on-chain authority"), { status: 503 });
    }
  }

  private async send(
    walletId: string,
    instruction: Parameters<Transaction["add"]>[0],
    authorizationPrivateKey: string,
  ): Promise<string> {
    const transaction = new Transaction().add(instruction);
    const latest = await this.connection.getLatestBlockhash("confirmed");
    transaction.feePayer = this.reviewer.publicKey;
    transaction.recentBlockhash = latest.blockhash;
    const result = await privy!.wallets().solana().signTransaction(walletId, {
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
    });
    const signed = Transaction.from(Buffer.from(result.signed_transaction, "base64"));
    signed.partialSign(this.reviewer);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    return signature;
  }

  private async ensureSellerFunding(seller: PublicKey): Promise<void> {
    const minimum = this.cluster === "devnet" ? 50_000_000 : 10_000_000;
    const balance = await this.connection.getBalance(seller, "confirmed");
    if (balance >= minimum) return;
    const transaction = new Transaction().add(SystemProgram.transfer({
      fromPubkey: this.reviewer.publicKey,
      toPubkey: seller,
      lamports: minimum - balance,
    }));
    const signature = await this.connection.sendTransaction(transaction, [this.reviewer]);
    await this.connection.confirmTransaction(signature, "confirmed");
  }
}
