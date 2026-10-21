import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { createApp } from "../src/index.js";
import { coalesce, heliusWebhook } from "../src/webhooks.js";

const SECRET = "test-webhook-secret";

function app() {
  let calls = 0;
  const webhooks = heliusWebhook({ secret: SECRET, onActivity: () => (calls += 1) });
  return { app: createApp({ webhooks }), calls: () => calls };
}

test("the Helius webhook refuses a missing or wrong secret and does nothing", async () => {
  const { app: server, calls } = app();
  await request(server).post("/api/webhooks/helius").send([{}]).expect(401);
  await request(server).post("/api/webhooks/helius").set("Authorization", "wrong").send([{}]).expect(401);
  await request(server).post("/api/webhooks/helius").set("Authorization", `${SECRET}x`).send([{}]).expect(401);
  assert.equal(calls(), 0);
});

test("the Helius webhook accepts the configured secret and triggers a reconcile", async () => {
  const { app: server, calls } = app();
  const response = await request(server).post("/api/webhooks/helius").set("Authorization", SECRET).send([{}, {}]).expect(200);
  assert.deepEqual(response.body, { ok: true, received: 2 });
  assert.equal(calls(), 1);
});

test("without a webhook router the route does not exist", async () => {
  await request(createApp()).post("/api/webhooks/helius").set("Authorization", SECRET).send([]).expect(404);
});

test("coalesce runs one task at a time and folds a burst into one follow-up run", async () => {
  let runs = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const run = coalesce(async () => {
    runs += 1;
    if (runs === 1) await gate;
  });
  const first = run();
  void run();
  void run();
  void run();
  assert.equal(runs, 1, "calls during a run wait for it");
  release();
  await first;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runs, 2, "the burst becomes exactly one more run");
  await run();
  assert.equal(runs, 3, "a later call runs again");
});

test("coalesce keeps going after a failed run", async () => {
  let runs = 0;
  const run = coalesce(async () => {
    runs += 1;
    if (runs === 1) throw new Error("rpc down");
  });
  await run();
  await run();
  assert.equal(runs, 2);
});
