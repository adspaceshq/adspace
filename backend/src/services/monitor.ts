import { and, count, eq, gte } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { chainTxs } from "../db/schema.js";
import type { EmailSender } from "./notifications.js";
import type { ReconcileReport } from "./reconciler.js";

export interface Alert {
  // Stable per condition, so repeats can be throttled.
  key: string;
  message: string;
}

export interface MonitorInput {
  now: Date;
  // Fee payer SOL in lamports; it pays every fee and tops up sellers' rent.
  feePayerLamports?: number;
  minFeePayerLamports: number;
  lastReconcile?: { at: Date; report?: ReconcileReport; error?: string };
  reconcileEveryMs: number;
  failedTxWindowMs: number;
}

// Everything an operator must act on. Each check stands alone so one bad read can't hide the rest.
export async function collectAlerts(db: Db, input: MonitorInput): Promise<Alert[]> {
  const alerts: Alert[] = [];
  const since = new Date(input.now.getTime() - input.failedTxWindowMs);
  const [failed] = await db
    .select({ n: count() })
    .from(chainTxs)
    .where(and(eq(chainTxs.status, "failed"), gte(chainTxs.updatedAt, since)));
  if (failed && failed.n > 0) {
    alerts.push({ key: "failed-txs", message: `${failed.n} chain transaction(s) failed in the last ${Math.round(input.failedTxWindowMs / 60_000)} minutes` });
  }

  if (input.feePayerLamports !== undefined && input.feePayerLamports < input.minFeePayerLamports) {
    alerts.push({ key: "fee-payer-low", message: `fee payer has ${(input.feePayerLamports / 1e9).toFixed(4)} SOL, below ${(input.minFeePayerLamports / 1e9).toFixed(4)} SOL` });
  }

  const last = input.lastReconcile;
  if (!last || input.now.getTime() - last.at.getTime() > 3 * input.reconcileEveryMs) {
    alerts.push({ key: "reconciler-stalled", message: "reconciler has not completed a run recently" });
  } else if (last.error) {
    alerts.push({ key: "reconciler-error", message: `reconciler failed: ${last.error}` });
  } else if (last.report?.spotDrift.length) {
    const ids = last.report.spotDrift.map((drift) => drift.spotId.slice(0, 8)).join(", ");
    alerts.push({ key: "spot-drift", message: `${last.report.spotDrift.length} spot(s) disagree with the chain: ${ids}` });
  }
  return alerts;
}

// Logs every alert and emails operators, repeating a condition at most once per `repeatMs`.
export function alertNotifier(options: { send?: EmailSender; to: string[]; repeatMs: number }) {
  const lastSent = new Map<string, number>();
  return async (alerts: Alert[], now = new Date()) => {
    const due = alerts.filter((alert) => now.getTime() - (lastSent.get(alert.key) ?? 0) >= options.repeatMs);
    for (const alert of alerts) console.error(`ALERT ${alert.key}: ${alert.message}`);
    if (!due.length) return due;
    for (const alert of due) lastSent.set(alert.key, now.getTime());
    if (options.send && options.to.length) {
      const text = due.map((alert) => `- ${alert.message}`).join("\n");
      const html = `<ul>${due.map((alert) => `<li>${escapeHtml(alert.message)}</li>`).join("")}</ul>`;
      for (const to of options.to) {
        await options.send({ to, subject: `adspaces alert: ${due.map((alert) => alert.key).join(", ")}`, text, html }).catch((error) =>
          console.error("alert email failed:", error instanceof Error ? error.message : error),
        );
      }
    }
    return due;
  };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
