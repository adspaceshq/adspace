import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { loadKeypair } from "./keypair.js";
import { usdcMintFor } from "./payout.js";
import type { SolanaCluster } from "./config.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const WITHDRAW_SELLER = Buffer.from([36, 53, 86, 71, 125, 229, 115, 98]);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const ata = (owner: PublicKey, mint: PublicKey) => PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

const createAta = (payer: PublicKey, owner: PublicKey, mint: PublicKey, address: PublicKey) => new TransactionInstruction({
  programId: ASSOCIATED_TOKEN_PROGRAM_ID,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true }, { pubkey: address, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([1]),
});

export interface SettlementExecutor { settle(spotId: string): Promise<string>; }

export class ProgramSettlementExecutor implements SettlementExecutor {
  private readonly connection: Connection;
  private readonly programId: PublicKey;
  private readonly mint: PublicKey;
  private readonly caller: Keypair;

  constructor(private readonly pool: Pool, rpcUrl: string, cluster: SolanaCluster, programId: string, walletPath: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.programId = new PublicKey(programId);
    this.mint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT));
    this.caller = loadKeypair(walletPath);
  }

  async settle(spotId: string): Promise<string> {
    const result = await this.pool.query(
      `SELECT s.chain_address,s.chain_vault_address,l.chain_address listing_address,u.wallet_address seller_wallet
       FROM spots s JOIN listings l ON l.id=s.listing_id JOIN users u ON u.id=l.seller_user_id WHERE s.id=$1`, [spotId],
    );
    const row = result.rows[0];
    if (!row) throw httpError("spot not found", 404);
    if (!row.chain_address || !row.chain_vault_address || !row.listing_address) throw httpError("spot is not published on-chain", 409);
    if (!row.seller_wallet) throw httpError("seller embedded wallet is unavailable", 409);
    const seller = new PublicKey(row.seller_wallet);
    const config = PublicKey.findProgramAddressSync([Buffer.from("config")], this.programId)[0];
    const configAccount = await this.connection.getAccountInfo(config, "confirmed");
    if (!configAccount || configAccount.data.length < 104) throw httpError("program config is unavailable", 503);
    const treasury = new PublicKey(configAccount.data.subarray(72, 104));
    const sellerAta = ata(seller, this.mint);
    const treasuryAta = ata(treasury, this.mint);
    const transaction = new Transaction();
    if (!(await this.connection.getAccountInfo(sellerAta))) transaction.add(createAta(this.caller.publicKey, seller, this.mint, sellerAta));
    if (!(await this.connection.getAccountInfo(treasuryAta))) transaction.add(createAta(this.caller.publicKey, treasury, this.mint, treasuryAta));
    transaction.add(new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: this.caller.publicKey, isSigner: true, isWritable: false },
        { pubkey: new PublicKey(row.listing_address), isSigner: false, isWritable: false },
        { pubkey: seller, isSigner: false, isWritable: true },
        { pubkey: new PublicKey(row.chain_address), isSigner: false, isWritable: true },
        { pubkey: new PublicKey(row.chain_vault_address), isSigner: false, isWritable: true },
        { pubkey: sellerAta, isSigner: false, isWritable: true },
        { pubkey: treasuryAta, isSigner: false, isWritable: true },
        { pubkey: PublicKey.findProgramAddressSync([Buffer.from("proof"), new PublicKey(row.chain_address).toBuffer()], this.programId)[0], isSigner: false, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ], data: WITHDRAW_SELLER,
    }));
    const signature = await this.connection.sendTransaction(transaction, [this.caller]);
    await this.connection.confirmTransaction(signature, "confirmed");
    await this.pool.query("UPDATE spots SET chain_settlement_signature=$2,updated_at=now() WHERE id=$1", [spotId, signature]);
    return signature;
  }
}
