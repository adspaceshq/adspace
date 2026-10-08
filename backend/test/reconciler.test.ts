import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { chainTxs, withdrawals } from "../src/db/schema.js";
import { reconcile, type ChainSpotStatus, type SignatureOutcome } from "../src/services/reconciler.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser, USDC } from "./helpers/seed.js";

const MINUTE = 60 * 1000;

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

async function tx(status: "submitted" | "failed" | "confirmed", ageMs: number, key = `op:${randomUUID()}`) {
  const updatedAt = new Date(Date.now() - ageMs);
  const [row] = await db
    .insert(chainTxs)
    .values({
      op: "claim_spot",
      idempotencyKey: key,
      status,
      signature: `sig-${randomUUID()}`,
      confirmedAt: status === "confirmed" ? updatedAt : null,
      updatedAt,
    })
    .returning();
  return row;
}

function deps(outcomes: Record<string, SignatureOutcome>, spotStatus: Record<string, ChainSpotStatus> = {}) {
  return {
    db,
    signatureOutcomes: async (signatures: string[]) =>
      new Map(signatures.map((signature) => [signature, outcomes[signature] ?? "missing"] as const)),
    readSpotStatus: async (address: string) => spotStatus[address] ?? "open",
  };
}

test("settles stuck and wrongly failed transactions from their signatures", async () => {
  const landed = await tx("submitted", 5 * MINUTE);
  const lost = await tx("submitted", 5 * MINUTE);
  const recent = await tx("submitted", 10_000);
  const timedOutButLanded = await tx("failed", 30 * MINUTE);
  const report = await reconcile(deps({ [landed.signature!]: "confirmed", [timedOutButLanded.signature!]: "confirmed" }));

  const status = async (id: string) => (await db.select().from(chainTxs).where(eq(chainTxs.id, id)))[0].status;
  assert.equal(await status(landed.id), "confirmed");
  assert.equal(await status(lost.id), "failed");
  assert.equal(await status(recent.id), "submitted");
  assert.equal(await status(timedOutButLanded.id), "confirmed");
  assert.ok(report.confirmedTxs >= 2);
});

test("withdrawals follow their transaction's real outcome", async () => {
  const { user } = await seedUser(db);
  const [withdrawal] = await db
    .insert(withdrawals)
    .values({ userId: user.id, amount: 5n * USDC, destination: "dest", state: "failed" })
    .returning();
  const failedTx = await tx("failed", 10 * MINUTE, `withdrawal:${withdrawal.id}`);
  await reconcile(deps({ [failedTx.signature!]: "confirmed" }));
  const [fixed] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawal.id));
  assert.equal(fixed.state, "confirmed");
  assert.equal(fixed.chainTxId, failedTx.id);
});

test("reports spots whose state disagrees with the chain", async () => {
  const hour = 60 * MINUTE;
  const healthy = await seedListing(db, { deadline: new Date(Date.now() + hour), deliveryDueAt: new Date(Date.now() + 2 * hour), funded: true });
  const drifted = await seedListing(db, { deadline: new Date(Date.now() + hour), deliveryDueAt: new Date(Date.now() + 2 * hour) });
  const report = await reconcile(
    deps({}, { [healthy.spot.chainAddress!]: "funded", [drifted.spot.chainAddress!]: "funded" }),
  );
  assert.deepEqual(
    report.spotDrift.filter((item) => [healthy.spot.id, drifted.spot.id].includes(item.spotId)),
    [{ spotId: drifted.spot.id, dbState: "open", chainStatus: "funded" }],
  );
});
