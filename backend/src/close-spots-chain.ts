import { readFileSync } from "node:fs";
import type { Pool } from "pg";
import { Connection,Keypair,PublicKey,Transaction,TransactionInstruction } from "@solana/web3.js";
import { privy } from "./auth.js";
import type { SessionUser } from "./types.js";

const TOKEN=new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const CLOSE_SPOT=Buffer.from([120,210,73,225,51,123,54,248]);
const error=(message:string,status:number)=>Object.assign(new Error(message),{status});
export interface CloseSpotsChainExecutor{close(slug:string,seller:SessionUser):Promise<string[]>}

export class PrivyCloseSpotsChainExecutor implements CloseSpotsChainExecutor{
  private connection:Connection;private program:PublicKey;private payer:Keypair;
  constructor(private pool:Pool,rpc:string,program:string,walletPath:string){this.connection=new Connection(rpc,"confirmed");this.program=new PublicKey(program);this.payer=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(walletPath,"utf8"))))}
  async close(slug:string,seller:SessionUser):Promise<string[]>{
    const result=await this.pool.query(`SELECT l.seller_user_id,l.chain_address listing_address,s.chain_address spot_address,s.chain_vault_address vault_address FROM listings l LEFT JOIN spots s ON s.listing_id=l.id AND s.status='open' WHERE l.slug=$1 ORDER BY s.created_at,s.id`,[slug]);
    if(!result.rows[0])throw error("listing not found",404);if(result.rows[0].seller_user_id!==seller.id)throw error("forbidden",403);
    const rows=result.rows.filter(r=>r.listing_address&&r.spot_address&&r.vault_address);if(!rows.length)return[];
    if(!privy||!seller.walletAddress)throw error("seller Privy wallet is unavailable",409);const authKey=process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY;if(!authKey)throw error("Privy authorization key is not configured",503);
    const sellerKey=new PublicKey(seller.walletAddress),user=await privy.users()._get(seller.did),wallet=user.linked_accounts.find(a=>a.type==="wallet"&&a.chain_type==="solana"&&a.address===sellerKey.toBase58()&&a.wallet_client_type==="privy");if(!wallet||!("id" in wallet)||!wallet.id||!("delegated" in wallet)||!wallet.delegated)throw error("seller must enable gasless transactions first",409);
    const signatures:string[]=[];for(const row of rows){const spot=new PublicKey(row.spot_address);if(!(await this.connection.getAccountInfo(spot,"confirmed")))continue;const ix=new TransactionInstruction({programId:this.program,keys:[{pubkey:sellerKey,isSigner:true,isWritable:true},{pubkey:new PublicKey(row.listing_address),isSigner:false,isWritable:false},{pubkey:spot,isSigner:false,isWritable:true},{pubkey:new PublicKey(row.vault_address),isSigner:false,isWritable:true},{pubkey:TOKEN,isSigner:false,isWritable:false}],data:CLOSE_SPOT});const latest=await this.connection.getLatestBlockhash("confirmed"),tx=new Transaction({feePayer:this.payer.publicKey,blockhash:latest.blockhash,lastValidBlockHeight:latest.lastValidBlockHeight}).add(ix),result=await privy.wallets().solana().signTransaction(wallet.id,{transaction:tx.serialize({requireAllSignatures:false,verifySignatures:false}),authorization_context:{authorization_private_keys:[authKey]}}),signed=Transaction.from(Buffer.from(result.signed_transaction,"base64"));signed.partialSign(this.payer);const signature=await this.connection.sendRawTransaction(signed.serialize());await this.connection.confirmTransaction({signature,...latest},"confirmed");signatures.push(signature)}return signatures;
  }
}
