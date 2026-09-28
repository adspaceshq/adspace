import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { SolanaCluster } from "./config.js";
import { isSignatureLike, usdcMintFor } from "./payout.js";

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });
const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export interface WalletWithdrawal {
  id: string;
  source: string;
  destination: string;
  amount: number;
  status: "pending" | "confirmed" | "failed";
  signature?: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface WithdrawalRepository {
  migrate?(): Promise<void>;
  create(userId: string, source: string, destination: string, amount: number): Promise<WalletWithdrawal>;
  confirm(id: string, userId: string, signature: string): Promise<WalletWithdrawal>;
  fail(id: string, userId: string): Promise<WalletWithdrawal>;
  list(userId: string): Promise<WalletWithdrawal[]>;
  get(id: string, userId: string): Promise<WalletWithdrawal>;
}

function validate(source: string, destination: string, amount: number): void {
  if (!addressPattern.test(source) || !addressPattern.test(destination)) throw httpError("invalid Solana address", 400);
  if (source === destination) throw httpError("destination must be a different wallet", 400);
  if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 1_000_000) !== amount * 1_000_000) {
    throw httpError("invalid USDC amount", 400);
  }
}

export class MemoryWithdrawalRepository implements WithdrawalRepository {
  private records: Array<WalletWithdrawal & { userId: string }> = [];
  async create(userId: string, source: string, destination: string, amount: number): Promise<WalletWithdrawal> {
    validate(source, destination, amount);
    const record = { id: randomUUID(), userId, source, destination, amount, status: "pending" as const, createdAt: new Date().toISOString() };
    this.records.push(record);
    return record;
  }
  async confirm(id: string, userId: string, signature: string): Promise<WalletWithdrawal> {
    if (!isSignatureLike(signature)) throw httpError("invalid transaction signature", 400);
    const record = this.records.find((item) => item.id === id && item.userId === userId);
    if (!record) throw httpError("withdrawal not found", 404);
    record.status = "confirmed"; record.signature = signature; record.confirmedAt = new Date().toISOString();
    return record;
  }
  async fail(id: string, userId: string): Promise<WalletWithdrawal> {
    const record = this.records.find((item) => item.id === id && item.userId === userId);
    if (!record) throw httpError("withdrawal not found", 404);
    record.status = "failed";
    return record;
  }
  async list(userId: string): Promise<WalletWithdrawal[]> {
    return this.records.filter((item) => item.userId === userId).slice().reverse();
  }
  async get(id: string, userId: string): Promise<WalletWithdrawal> {
    const record = this.records.find((item) => item.id === id && item.userId === userId);
    if (!record) throw httpError("withdrawal not found", 404);
    return record;
  }
}

type WithdrawalRow = {
  id: string; source_wallet: string; destination_wallet: string; amount: string; status: WalletWithdrawal["status"];
  signature: string | null; created_at: Date; confirmed_at: Date | null;
};

export class PostgresWithdrawalRepository implements WithdrawalRepository {
  constructor(
    private pool: Pool,
    private rpcUrl: string,
    private cluster: SolanaCluster,
    private mint = usdcMintFor(cluster, process.env.USDC_MINT),
    private dailyLimit = Number(process.env.WITHDRAWAL_DAILY_LIMIT_USDC ?? 1000),
  ) {}

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS wallet_withdrawals (
        id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source_wallet text NOT NULL, destination_wallet text NOT NULL, amount numeric(20,6) NOT NULL,
        status text NOT NULL CHECK (status IN ('pending','confirmed','failed')),
        signature text UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), confirmed_at timestamptz
      );
      CREATE INDEX IF NOT EXISTS wallet_withdrawals_user_created_idx ON wallet_withdrawals(user_id, created_at DESC);
      ALTER TABLE wallet_withdrawals ENABLE ROW LEVEL SECURITY;
    `);
  }

  async create(userId: string, source: string, destination: string, amount: number): Promise<WalletWithdrawal> {
    validate(source, destination, amount);
    const used = await this.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount),0) total FROM wallet_withdrawals
       WHERE user_id=$1 AND status IN ('pending','confirmed') AND created_at > now() - interval '24 hours'`,
      [userId],
    );
    if (Number(used.rows[0]?.total ?? 0) + amount > this.dailyLimit) throw httpError(`daily withdrawal limit is ${this.dailyLimit} USDC`, 429);
    const result = await this.pool.query<WithdrawalRow>(
      `INSERT INTO wallet_withdrawals (id,user_id,source_wallet,destination_wallet,amount,status)
       VALUES ($1,$2,$3,$4,$5,'pending') RETURNING *`,
      [randomUUID(), userId, source, destination, amount],
    );
    return this.map(result.rows[0]);
  }

  async confirm(id: string, userId: string, signature: string): Promise<WalletWithdrawal> {
    if (!isSignatureLike(signature)) throw httpError("invalid transaction signature", 400);
    const found = await this.pool.query<WithdrawalRow>("SELECT * FROM wallet_withdrawals WHERE id=$1 AND user_id=$2", [id, userId]);
    const record = found.rows[0];
    if (!record) throw httpError("withdrawal not found", 404);
    if (record.status === "confirmed") return this.map(record);
    await this.pool.query(
      "UPDATE wallet_withdrawals SET signature=COALESCE(signature,$3) WHERE id=$1 AND user_id=$2",
      [id, userId, signature],
    );
    await this.verify(record, signature);
    const updated = await this.pool.query<WithdrawalRow>(
      `UPDATE wallet_withdrawals SET status='confirmed',signature=$3,confirmed_at=now()
       WHERE id=$1 AND user_id=$2 RETURNING *`, [id, userId, signature],
    );
    return this.map(updated.rows[0]);
  }

  async fail(id: string, userId: string): Promise<WalletWithdrawal> {
    const updated = await this.pool.query<WithdrawalRow>(
      `UPDATE wallet_withdrawals SET status='failed' WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *`, [id, userId],
    );
    if (!updated.rows[0]) throw httpError("pending withdrawal not found", 404);
    return this.map(updated.rows[0]);
  }

  async list(userId: string): Promise<WalletWithdrawal[]> {
    const result = await this.pool.query<WithdrawalRow>(
      "SELECT * FROM wallet_withdrawals WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [userId],
    );
    return result.rows.map((row) => this.map(row));
  }

  async get(id: string, userId: string): Promise<WalletWithdrawal> {
    const result = await this.pool.query<WithdrawalRow>(
      "SELECT * FROM wallet_withdrawals WHERE id=$1 AND user_id=$2", [id, userId],
    );
    if (!result.rows[0]) throw httpError("withdrawal not found", 404);
    return this.map(result.rows[0]);
  }

  private async verify(record: WithdrawalRow, signature: string): Promise<void> {
    const response = await fetch(this.rpcUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
    }).catch(() => null);
    if (!response?.ok) throw httpError("could not verify withdrawal", 503);
    const body = await response.json() as { result?: { meta?: { err?: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } } | null };
    const meta = body.result?.meta;
    if (!meta || meta.err) throw httpError("withdrawal is not confirmed", 409);
    const change = (owner: string) => total(meta.postTokenBalances, owner, this.mint) - total(meta.preTokenBalances, owner, this.mint);
    const amount = Number(record.amount);
    if (change(record.destination_wallet) + 0.000001 < amount || change(record.source_wallet) > -amount + 0.000001) {
      throw httpError(`transaction does not match this ${this.cluster} withdrawal`, 409);
    }
  }

  private map(row: WithdrawalRow): WalletWithdrawal {
    return {
      id: row.id, source: row.source_wallet, destination: row.destination_wallet, amount: Number(row.amount), status: row.status,
      signature: row.signature ?? undefined, createdAt: row.created_at.toISOString(), confirmedAt: row.confirmed_at?.toISOString(),
    };
  }
}

type TokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { uiAmount?: number | null } };
function total(balances: TokenBalance[] | undefined, owner: string, mint: string): number {
  return (balances ?? []).filter((item) => item.owner === owner && item.mint === mint)
    .reduce((sum, item) => sum + (item.uiTokenAmount?.uiAmount ?? 0), 0);
}
