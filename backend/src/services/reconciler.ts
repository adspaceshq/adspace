import { and, eq, gte, inArray, isNotNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Db } from "../db/client.js";
import { chainTxs, spots, withdrawals } from "../db/schema.js";

// What the chain says about a transaction signature; `missing` means not found at all.
export type SignatureOutcome = "confirmed" | "failed" | "missing";
// On-chain spot status; `closed` means the account no longer exists (settled/refunded/cancelled).
export type ChainSpotStatus = "open" | "funded" | "finalized" | "cancelled" | "disputed" | "closed";

export interface ReconcilerDeps {
  db: Db;
  signatureOutcomes: (signatures: string[]) => Promise<Map<string, SignatureOutcome>>;
  readSpotStatus: (address: string) => Promise<ChainSpotStatus>;
  now?: () => Date;
}

export interface SpotDrift {
  spotId: string;
  dbState: string;
  chainStatus: ChainSpotStatus;
}

export interface ReconcileReport {
  checkedTxs: number;
  confirmedTxs: number;
  failedTxs: number;
  withdrawalsUpdated: number;
  spotDrift: SpotDrift[];
}

// A blockhash expires within ~2 minutes; an unseen signature older than this never lands.
const LANDING_WINDOW_MS = 2 * 60 * 1000;
// Failed rows are rechecked for a week in case a confirmation timed out but the tx landed.
const FAILED_RECHECK_MS = 7 * 24 * 60 * 60 * 1000;

// Which DB spot states are consistent with each on-chain status.
const consistent: Record<ChainSpotStatus, readonly string[]> = {
  open: ["open"],
  funded: ["funded", "delivered"],
  disputed: ["disputed"],
  finalized: ["settled"],
  cancelled: ["cancelled", "refunded"],
  closed: ["settled", "refunded", "cancelled"],
};

async function reconcileTransactions(deps: ReconcilerDeps, now: Date) {
  const rows = await deps.db
    .select({ id: chainTxs.id, status: chainTxs.status, signature: chainTxs.signature, updatedAt: chainTxs.updatedAt })
    .from(chainTxs)
    .where(
      and(
        isNotNull(chainTxs.signature),
        or(
          and(eq(chainTxs.status, "submitted"), lt(chainTxs.updatedAt, new Date(now.getTime() - LANDING_WINDOW_MS))),
          and(eq(chainTxs.status, "failed"), gte(chainTxs.updatedAt, new Date(now.getTime() - FAILED_RECHECK_MS))),
        ),
      ),
    );
  let confirmed = 0;
  let failed = 0;
  for (let index = 0; index < rows.length; index += 256) {
    const batch = rows.slice(index, index + 256);
    const outcomes = await deps.signatureOutcomes(batch.map((row) => row.signature!));
    for (const row of batch) {
      const outcome = outcomes.get(row.signature!) ?? "missing";
      if (outcome === "confirmed") {
        await deps.db
          .update(chainTxs)
          .set({ status: "confirmed", confirmedAt: now, error: null, updatedAt: now })
          .where(eq(chainTxs.id, row.id));
        confirmed += 1;
      } else if (row.status === "submitted") {
        await deps.db
          .update(chainTxs)
          .set({ status: "failed", error: outcome === "failed" ? "failed on-chain" : "never landed", updatedAt: now })
          .where(eq(chainTxs.id, row.id));
        failed += 1;
      }
    }
  }
  return { checked: rows.length, confirmed, failed };
}

// Withdrawal ids are embedded in their transaction keys (`withdrawal:<id>`).
const withdrawalKey = (id: PgColumn): SQL => sql`'withdrawal:' || ${id}::text`;

async function reconcileWithdrawals(deps: ReconcilerDeps, now: Date) {
  const rows = await deps.db
    .select({ withdrawal: withdrawals, tx: chainTxs })
    .from(withdrawals)
    .innerJoin(chainTxs, eq(chainTxs.idempotencyKey, withdrawalKey(withdrawals.id)))
    .where(inArray(withdrawals.state, ["pending", "submitted", "failed"]));
  let updated = 0;
  for (const { withdrawal, tx } of rows) {
    const target = tx.status === "confirmed" ? "confirmed" : tx.status === "failed" ? "failed" : undefined;
    if (!target || target === withdrawal.state) continue;
    await deps.db
      .update(withdrawals)
      .set({ state: target, chainTxId: tx.id, updatedAt: now })
      .where(eq(withdrawals.id, withdrawal.id));
    updated += 1;
  }
  return updated;
}

async function detectSpotDrift(deps: ReconcilerDeps): Promise<SpotDrift[]> {
  const rows = await deps.db
    .select({ id: spots.id, state: spots.state, chainAddress: spots.chainAddress })
    .from(spots)
    .where(and(isNotNull(spots.chainAddress), notInArray(spots.state, ["settled", "refunded", "cancelled"])));
  const drift: SpotDrift[] = [];
  for (const row of rows) {
    const chainStatus = await deps.readSpotStatus(row.chainAddress!);
    if (!consistent[chainStatus].includes(row.state)) drift.push({ spotId: row.id, dbState: row.state, chainStatus });
  }
  return drift;
}

export async function reconcile(deps: ReconcilerDeps): Promise<ReconcileReport> {
  const now = deps.now?.() ?? new Date();
  const txs = await reconcileTransactions(deps, now);
  const withdrawalsUpdated = await reconcileWithdrawals(deps, now);
  const spotDrift = await detectSpotDrift(deps);
  return {
    checkedTxs: txs.checked,
    confirmedTxs: txs.confirmed,
    failedTxs: txs.failed,
    withdrawalsUpdated,
    spotDrift,
  };
}
