import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { loadKeypair } from "./keypair.js";
import { usdcMintFor } from "./payout.js";
import type { SolanaCluster } from "./config.js";

const TOKEN_PROGRAM_ID=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),ATA_PROGRAM_ID=new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const RESOLVE=Buffer.from([231,6,202,6,96,103,12,230]);
const fail=(m:string,s:number)=>Object.assign(new Error(m),{status:s});
const ata=(o:PublicKey,m:PublicKey)=>PublicKey.findProgramAddressSync([o.toBuffer(),TOKEN_PROGRAM_ID.toBuffer(),m.toBuffer()],ATA_PROGRAM_ID)[0];
const str=(v:string)=>{const b=Buffer.from(v),l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b]);};
const createAta=(p:PublicKey,o:PublicKey,m:PublicKey,a:PublicKey)=>new TransactionInstruction({programId:ATA_PROGRAM_ID,keys:[{pubkey:p,isSigner:true,isWritable:true},{pubkey:a,isSigner:false,isWritable:true},{pubkey:o,isSigner:false,isWritable:false},{pubkey:m,isSigner:false,isWritable:false},{pubkey:SystemProgram.programId,isSigner:false,isWritable:false},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}],data:Buffer.from([1])});
export interface DisputeResolutionExecutor{resolve(spotId:string,sellerShareBps:number,decision:string):Promise<string>}
export class ProgramDisputeResolutionExecutor implements DisputeResolutionExecutor{
 private connection:Connection;private programId:PublicKey;private mint:PublicKey;private resolver:Keypair;
 constructor(private pool:Pool,rpc:string,cluster:SolanaCluster,pid:string,wallet:string,private baseUrl:string){this.connection=new Connection(rpc,"confirmed");this.programId=new PublicKey(pid);this.mint=new PublicKey(usdcMintFor(cluster,process.env.USDC_MINT));this.resolver=loadKeypair(wallet);}
 async resolve(spotId:string,sellerShareBps:number,decision:string){
  if(!Number.isInteger(sellerShareBps)||sellerShareBps<0||sellerShareBps>10000)throw fail("seller share must be between 0 and 10000 bps",400);if(!decision.trim())throw fail("decision is required",400);
  const q=await this.pool.query(`SELECT s.chain_address,s.chain_vault_address,l.chain_address listing_address,l.slug,u.wallet_address seller_wallet,bu.wallet_address buyer_wallet FROM spots s JOIN listings l ON l.id=s.listing_id JOIN users u ON u.id=l.seller_user_id LEFT JOIN users bu ON bu.id=s.buyer_user_id WHERE s.id=$1`,[spotId]),r=q.rows[0];
  if(!r)throw fail("spot not found",404);if(!r.chain_address||!r.chain_vault_address||!r.listing_address||!r.seller_wallet||!r.buyer_wallet)throw fail("dispute accounts are incomplete",409);
  const spot=new PublicKey(r.chain_address),seller=new PublicKey(r.seller_wallet),buyer=new PublicKey(r.buyer_wallet),config=PublicKey.findProgramAddressSync([Buffer.from("config")],this.programId)[0],dispute=PublicKey.findProgramAddressSync([Buffer.from("dispute"),spot.toBuffer()],this.programId)[0];
  const ca=await this.connection.getAccountInfo(config);if(!ca)throw fail("program config is unavailable",503);const treasury=new PublicKey(ca.data.subarray(72,104)),sellerAta=ata(seller,this.mint),buyerAta=ata(buyer,this.mint),treasuryAta=ata(treasury,this.mint),tx=new Transaction();
  for(const [owner,address] of [[seller,sellerAta],[buyer,buyerAta],[treasury,treasuryAta]] as const)if(!(await this.connection.getAccountInfo(address)))tx.add(createAta(this.resolver.publicKey,owner,this.mint,address));
  const hash=createHash("sha256").update(decision).digest(),uri=`${this.baseUrl.replace(/\/$/,"")}/listings/${encodeURIComponent(r.slug)}#decision-${spotId}`,bps=Buffer.alloc(2);bps.writeUInt16LE(sellerShareBps);
  tx.add(new TransactionInstruction({programId:this.programId,keys:[{pubkey:this.resolver.publicKey,isSigner:true,isWritable:false},{pubkey:config,isSigner:false,isWritable:false},{pubkey:new PublicKey(r.listing_address),isSigner:false,isWritable:false},{pubkey:spot,isSigner:false,isWritable:true},{pubkey:dispute,isSigner:false,isWritable:true},{pubkey:new PublicKey(r.chain_vault_address),isSigner:false,isWritable:true},{pubkey:sellerAta,isSigner:false,isWritable:true},{pubkey:seller,isSigner:false,isWritable:true},{pubkey:buyerAta,isSigner:false,isWritable:true},{pubkey:treasuryAta,isSigner:false,isWritable:true},{pubkey:this.mint,isSigner:false,isWritable:false},{pubkey:TOKEN_PROGRAM_ID,isSigner:false,isWritable:false}],data:Buffer.concat([RESOLVE,bps,hash,str(uri)])}));
  const sig=await this.connection.sendTransaction(tx,[this.resolver]);await this.connection.confirmTransaction(sig,"confirmed");await this.pool.query("UPDATE spots SET chain_resolution_signature=$2,updated_at=now() WHERE id=$1",[spotId,sig]);return sig;
 }
}
