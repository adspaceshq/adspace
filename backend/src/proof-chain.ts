import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { privy } from "./auth.js";
import { loadKeypair } from "./keypair.js";
import type { SessionUser } from "./types.js";

const SUBMIT_PROOF = Buffer.from([54, 241, 46, 84, 4, 212, 46, 94]);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const borshString = (value: string) => {
  const bytes = Buffer.from(value);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
};

export interface ProofChainExecutor {
  submit(spotId: string, seller: SessionUser, proof: { photos: unknown; postUrl?: unknown }): Promise<string>;
}

export class PrivyProofChainExecutor implements ProofChainExecutor {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly feePayer: Keypair;

  constructor(private readonly pool: Pool, rpcUrl: string, programId: string, walletPath: string, private readonly publicBaseUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.feePayer = loadKeypair(walletPath);
  }

  async submit(spotId: string, seller: SessionUser, proofInput: { photos: unknown; postUrl?: unknown }): Promise<string> {
    if (!privy || !seller.walletAddress) throw httpError("seller Privy wallet is unavailable", 409);
    const authorizationPrivateKey = process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;
    if (!authorizationPrivateKey) throw httpError("Privy authorization key is not configured", 503);
    const result = await this.pool.query(
      `SELECT s.chain_address,l.chain_address listing_address,l.slug,l.seller_user_id
       FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`, [spotId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (row.seller_user_id !== seller.id) throw httpError("forbidden", 403);
    if (!row.chain_address || !row.listing_address) throw httpError("spot is not published on-chain", 409);
    const sellerKey = new PublicKey(seller.walletAddress);
    const spotKey = new PublicKey(row.chain_address);
    const proofKey = PublicKey.findProgramAddressSync([Buffer.from("proof"), spotKey.toBuffer()], this.programId)[0];
    const digest = createHash("sha256").update(JSON.stringify(proofInput)).digest();
    const proofUri = `${this.publicBaseUrl.replace(/\/$/, "")}/listings/${encodeURIComponent(row.slug)}#proof-${spotId}`;
    const instruction = new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: sellerKey, isSigner: true, isWritable: true },
        { pubkey: new PublicKey(row.listing_address), isSigner: false, isWritable: false },
        { pubkey: spotKey, isSigner: false, isWritable: true },
        { pubkey: proofKey, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([SUBMIT_PROOF, digest, borshString(proofUri)]),
    });
    const balance = await this.connection.getBalance(sellerKey);
    if (balance < 20_000_000) {
      const funding = await this.connection.sendTransaction(new Transaction().add(SystemProgram.transfer({ fromPubkey: this.feePayer.publicKey, toPubkey: sellerKey, lamports: 20_000_000 - balance })), [this.feePayer]);
      await this.connection.confirmTransaction(funding, "confirmed");
    }
    const privyUser = await privy.users()._get(seller.did);
    const wallet = privyUser.linked_accounts.find((account) => account.type === "wallet" && account.chain_type === "solana"
      && account.address === sellerKey.toBase58() && account.wallet_client_type === "privy");
    if (!wallet || !("id" in wallet) || !wallet.id || !("delegated" in wallet) || !wallet.delegated) throw httpError("seller must enable gasless transactions first", 409);
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const transaction = new Transaction({ feePayer: this.feePayer.publicKey, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }).add(instruction);
    const buyerSigned = await privy.wallets().solana().signTransaction(wallet.id, { transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }), authorization_context: { authorization_private_keys: [authorizationPrivateKey] } });
    const signed = Transaction.from(Buffer.from(buyerSigned.signed_transaction, "base64"));
    signed.partialSign(this.feePayer);
    const signature = await this.connection.sendRawTransaction(signed.serialize());
    await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    await this.pool.query("UPDATE spots SET chain_proof_signature=$2,updated_at=now() WHERE id=$1", [spotId, signature]);
    return signature;
  }
}
