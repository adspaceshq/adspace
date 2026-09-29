import type { Pool } from "pg";
import { Connection,PublicKey } from "@solana/web3.js";

export interface ReconciliationResult{checked:number;updated:number;missing:number}
export interface ChainReconciler{reconcile():Promise<ReconciliationResult>}
export class SolanaChainReconciler implements ChainReconciler{
  private connection:Connection;
  constructor(private pool:Pool,rpc:string){this.connection=new Connection(rpc,"confirmed")}
  async reconcile():Promise<ReconciliationResult>{
    const result=await this.pool.query(`SELECT id,chain_address,status,paid_at,disputed_at FROM spots WHERE chain_address<>''`),rows=result.rows;
    let updated=0,missing=0;
    for(let start=0;start<rows.length;start+=100){const batch=rows.slice(start,start+100),accounts=await this.connection.getMultipleAccountsInfo(batch.map(r=>new PublicKey(r.chain_address)),"confirmed");for(let i=0;i<batch.length;i++){const row=batch[i],account=accounts[i];if(!account){missing++;continue}if(account.data.length<=49)continue;const status=account.data[49];
      if(status===2&&!row.paid_at){await this.pool.query("UPDATE spots SET paid_at=now(),updated_at=now() WHERE id=$1 AND paid_at IS NULL",[row.id]);updated++}
      else if(status===3&&row.status!=="open"&&!row.paid_at){await this.pool.query("UPDATE spots SET paid_at=now(),payout_amount=0,payout_fee=0,updated_at=now() WHERE id=$1 AND paid_at IS NULL",[row.id]);updated++}
      else if(status===4&&!row.disputed_at){await this.pool.query("UPDATE spots SET disputed_at=now(),updated_at=now() WHERE id=$1 AND disputed_at IS NULL",[row.id]);updated++}
    }}return{checked:rows.length,updated,missing};
  }
}
