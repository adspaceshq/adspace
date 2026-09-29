import assert from "node:assert/strict";
import test from "node:test";
import { MemoryWithdrawalRepository } from "../src/withdrawals.js";

const source = "7xKXtg2CW87d97TXJSDpbD6ZkgXjEhrYRXhKuxP6jDA";
const destination = "8xKXtg2CW87d97TXJSDpbD6ZkgXjEhrYRXhKuxP6jDB";
const signature = "2".repeat(88);

test("wallet withdrawals are private to their user and record confirmed signatures", async () => {
  const repo = new MemoryWithdrawalRepository();
  const pending = await repo.create("user-one", source, destination, 12.5);
  assert.equal(pending.status, "pending");
  assert.equal((await repo.list("user-two")).length, 0);
  const processing = await repo.reserve(pending.id, "user-one");
  assert.equal(processing.status, "processing");
  const confirmed = await repo.confirm(pending.id, "user-one", signature);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.signature, signature);
});

test("a withdrawal can be reserved for execution only once", async () => {
  const repo = new MemoryWithdrawalRepository();
  const pending = await repo.create("user", source, destination, 2);
  const attempts = await Promise.allSettled([
    repo.reserve(pending.id, "user"),
    repo.reserve(pending.id, "user"),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  assert.equal(attempts.filter((attempt) => attempt.status === "rejected").length, 1);
});

test("a failed execution releases a processing withdrawal", async () => {
  const repo = new MemoryWithdrawalRepository();
  const pending = await repo.create("user", source, destination, 2);
  await repo.reserve(pending.id, "user");
  const failed = await repo.fail(pending.id, "user");
  assert.equal(failed.status, "failed");
});

test("wallet withdrawals reject unsafe requests", async () => {
  const repo = new MemoryWithdrawalRepository();
  await assert.rejects(() => repo.create("user", source, source, 1), /different wallet/);
  await assert.rejects(() => repo.create("user", source, destination, 0), /invalid USDC amount/);
  const pending = await repo.create("user", source, destination, 1);
  await assert.rejects(() => repo.confirm(pending.id, "user", "invalid"), /invalid transaction signature/);
});
