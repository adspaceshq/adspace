import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { privy } from "./auth.js";
import { loadKeypair } from "./keypair.js";
import type { SessionUser } from "./types.js";

const RAISE_DISPUTE = Buffer.from([41, 243, 1, 51, 150, 95, 246, 73]);
const WITHDRAW_DISPUTE = Buffer.from([96, 143, 114, 202, 143, 131, 26, 134]);
const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const borshString = (value: string) => { const bytes=Buffer.from(value); const length=Buffer.alloc(4); length.writeUInt32LE(bytes.length); return Buffer.concat([length,bytes]); };

export interface DisputeChainExecutor {
  raise(spotId: string, buyer: SessionUser, reason: string): Promise<string>;
  withdraw(spotId: string, buyer: SessionUser): Promise<string>;
}

export class PrivyDisputeChainExecutor implements DisputeChainExecutor {
  private connection: Connection;
  private programId: PublicKey;
  private feePayer: Keypair;
  constructor(private pool: Pool, rpcUrl: string, programId: string, walletPath: string, private baseUrl: string) {
    this.connection=new Connection(rpcUrl,"confirmed"); this.programId=new PublicKey(programId);
    this.feePayer=loadKeypair(walletPath);
  }
  async raise(spotId:string,buyer:SessionUser,reason:string):Promise<string>{
    if(!privy||!buyer.walletAddress) throw httpError("buyer Privy wallet is unavailable",409);
    const authKey=process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY; if(!authKey) throw httpError("Privy authorization key is not configured",503);
    const q=await this.pool.query(`SELECT s.chain_address,l.chain_address listing_address,l.slug,s.buyer_user_id
      FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,[spotId]); const row=q.rows[0];
    if(!row) throw httpError("spot not found",404); if(row.buyer_user_id!==buyer.id) throw httpError("only the winning buyer can dispute",403);
    if(!row.chain_address||!row.listing_address) throw httpError("spot is not published on-chain",409);
    const buyerKey=new PublicKey(buyer.walletAddress),spot=new PublicKey(row.chain_address);
    const dispute=PublicKey.findProgramAddressSync([Buffer.from("dispute"),spot.toBuffer()],this.programId)[0];
    const evidenceHash=createHash("sha256").update(reason).digest();
    const evidenceUri=`${this.baseUrl.replace(/\/$/,"")}/listings/${encodeURIComponent(row.slug)}#dispute-${spotId}`;
    const ix=new TransactionInstruction({programId:this.programId,keys:[
      {pubkey:buyerKey,isSigner:true,isWritable:true},{pubkey:new PublicKey(row.listing_address),isSigner:false,isWritable:false},
      {pubkey:spot,isSigner:false,isWritable:true},{pubkey:dispute,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}],data:Buffer.concat([RAISE_DISPUTE,evidenceHash,borshString(evidenceUri)])});
    const balance=await this.connection.getBalance(buyerKey); if(balance<20_000_000){const sig=await this.connection.sendTransaction(new Transaction().add(SystemProgram.transfer({fromPubkey:this.feePayer.publicKey,toPubkey:buyerKey,lamports:20_000_000-balance})),[this.feePayer]);await this.connection.confirmTransaction(sig,"confirmed");}
    const user=await privy.users()._get(buyer.did); const wallet=user.linked_accounts.find(a=>a.type==="wallet"&&a.chain_type==="solana"&&a.address===buyerKey.toBase58()&&a.wallet_client_type==="privy");
    if(!wallet||!("id" in wallet)||!wallet.id||!("delegated" in wallet)||!wallet.delegated) throw httpError("buyer must enable gasless transactions first",409);
    const latest=await this.connection.getLatestBlockhash("confirmed"); const tx=new Transaction({feePayer:this.feePayer.publicKey,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight}).add(ix);
    const buyerSigned=await privy.wallets().solana().signTransaction(wallet.id,{transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}),authorization_context:{authorization_private_keys:[authKey]}});
    const signed=Transaction.from(Buffer.from(buyerSigned.signed_transaction,"base64")); signed.partialSign(this.feePayer);
    const signature=await this.connection.sendRawTransaction(signed.serialize()); await this.connection.confirmTransaction({signature,...latest},"confirmed");
    await this.pool.query("UPDATE spots SET chain_dispute_signature=$2,updated_at=now() WHERE id=$1",[spotId,signature]); return signature;
  }

  async withdraw(spotId:string,buyer:SessionUser):Promise<string>{
    if(!privy||!buyer.walletAddress) throw httpError("buyer Privy wallet is unavailable",409);
    const authKey=process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY; if(!authKey) throw httpError("Privy authorization key is not configured",503);
    const q=await this.pool.query(`SELECT s.chain_address,l.chain_address listing_address,s.buyer_user_id,s.disputed_at
      FROM spots s JOIN listings l ON l.id=s.listing_id WHERE s.id=$1`,[spotId]); const row=q.rows[0];
    if(!row) throw httpError("spot not found",404); if(row.buyer_user_id!==buyer.id) throw httpError("only the winning buyer can withdraw the dispute",403);
    if(!row.disputed_at) throw httpError("spot has no open dispute",409);
    if(!row.chain_address||!row.listing_address) throw httpError("spot is not published on-chain",409);
    const buyerKey=new PublicKey(buyer.walletAddress),spot=new PublicKey(row.chain_address);
    const dispute=PublicKey.findProgramAddressSync([Buffer.from("dispute"),spot.toBuffer()],this.programId)[0];
    const ix=new TransactionInstruction({programId:this.programId,keys:[
      {pubkey:buyerKey,isSigner:true,isWritable:true},{pubkey:new PublicKey(row.listing_address),isSigner:false,isWritable:false},
      {pubkey:spot,isSigner:false,isWritable:true},{pubkey:dispute,isSigner:false,isWritable:true}],data:WITHDRAW_DISPUTE});
    const balance=await this.connection.getBalance(buyerKey); if(balance<20_000_000){const sig=await this.connection.sendTransaction(new Transaction().add(SystemProgram.transfer({fromPubkey:this.feePayer.publicKey,toPubkey:buyerKey,lamports:20_000_000-balance})),[this.feePayer]);await this.connection.confirmTransaction(sig,"confirmed");}
    const user=await privy.users()._get(buyer.did); const wallet=user.linked_accounts.find(a=>a.type==="wallet"&&a.chain_type==="solana"&&a.address===buyerKey.toBase58()&&a.wallet_client_type==="privy");
    if(!wallet||!("id" in wallet)||!wallet.id||!("delegated" in wallet)||!wallet.delegated) throw httpError("buyer must enable gasless transactions first",409);
    const latest=await this.connection.getLatestBlockhash("confirmed"); const tx=new Transaction({feePayer:this.feePayer.publicKey,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight}).add(ix);
    const buyerSigned=await privy.wallets().solana().signTransaction(wallet.id,{transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}),authorization_context:{authorization_private_keys:[authKey]}});
    const signed=Transaction.from(Buffer.from(buyerSigned.signed_transaction,"base64")); signed.partialSign(this.feePayer);
    const signature=await this.connection.sendRawTransaction(signed.serialize()); await this.connection.confirmTransaction({signature,...latest},"confirmed");
    return signature;
  }
}
