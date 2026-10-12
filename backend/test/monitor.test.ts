import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import request from "supertest";
import type { Db } from "../src/db/client.js";
import { chainTxs } from "../src/db/schema.js";
import { createApp } from "../src/index.js";
import { alertNotifier, collectAlerts, type MonitorInput } from "../src/services/monitor.js";
import type { EmailMessage } from "../src/services/notifications.js";
import { createV2Router } from "../src/v2/router.js";
import { createTestDb } from "./helpers/db.js";

let db: Db;
let close: () => Promise<void>;
before(async () => ({ db, close } = await createTestDb()));
after(async () => close());

const MINUTE = 60_000;
const base = (now: Date): MonitorInput => ({
  now,
  feePayerLamports: 5_000_000_000,
  minFeePayerLamports: 1_000_000_000,
  lastReconcile: { at: now, report: { checkedTxs: 0, confirmedTxs: 0, failedTxs: 0, withdrawalsUpdated: 0, spotDrift: [] } },
  reconcileEveryMs: 5 * MINUTE,
  failedTxWindowMs: 5 * MINUTE,
});

test("alerts cover failed txs, a low fee payer, reconciler stalls and errors, and spot drift", async () => {
  const now = new Date();
  assert.deepEqual(await collectAlerts(db, base(now)), []);

  await db.insert(chainTxs).values({ op: "claim_spot", idempotencyKey: `k-${randomUUID()}`, status: "failed", updatedAt: now });
  await db.insert(chainTxs).values({ op: "claim_spot", idempotencyKey: `k-${randomUUID()}`, status: "failed", updatedAt: new Date(now.getTime() - 60 * MINUTE) });
  const keys = async (input: MonitorInput) => (await collectAlerts(db, input)).map((alert) => alert.key);

  // Only the recent failure counts.
  assert.deepEqual(await keys(base(now)), ["failed-txs"]);
  const later = new Date(now.getTime() + 10 * MINUTE);
  const quiet = { ...base(later), failedTxWindowMs: MINUTE };

  assert.deepEqual(await keys({ ...quiet, feePayerLamports: 100 }), ["fee-payer-low"]);
  assert.deepEqual(await keys({ ...quiet, lastReconcile: { at: new Date(later.getTime() - 16 * MINUTE) } }), ["reconciler-stalled"]);
  assert.deepEqual(await keys({ ...quiet, lastReconcile: { at: later, error: "rpc down" } }), ["reconciler-error"]);
  const drift = { checkedTxs: 0, confirmedTxs: 0, failedTxs: 0, withdrawalsUpdated: 0, spotDrift: [{ spotId: randomUUID(), dbState: "funded", chainStatus: "closed" }] };
  assert.deepEqual(await keys({ ...quiet, lastReconcile: { at: later, report: drift } }), ["spot-drift"]);
});

test("each alert is emailed at most once per repeat window", async () => {
  const sent: EmailMessage[] = [];
  const notify = alertNotifier({ send: async (message) => void sent.push(message), to: ["ops@adspaces.test"], repeatMs: 60 * MINUTE });
  const alert = { key: "fee-payer-low", message: "fee payer has <0.1> SOL" };
  const start = new Date();

  assert.equal((await notify([alert], start)).length, 1);
  assert.equal((await notify([alert], new Date(start.getTime() + 10 * MINUTE))).length, 0);
  assert.equal((await notify([alert], new Date(start.getTime() + 61 * MINUTE))).length, 1);
  assert.equal(sent.length, 2);
  assert.match(sent[0].html, /&#60;0\.1&#62;/);
});

test("the v2 health check reports the database and rpc", async () => {
  const app = createApp({ v2Router: createV2Router({ db, reviewers: [], termsVersion: "test", metadataBaseUrl: "https://adspaces.test" }) });
  const response = await request(app).get("/api/v2/health");
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: "ok", database: "ok", rpc: "not configured" });
});
