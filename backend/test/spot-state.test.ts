import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidTransitionError,
  canTransition,
  nextSpotState,
  terminalSpotStates,
  type SpotEvent,
} from "../src/domain/spot-state.js";

test("happy path: claim, deliver, pay", () => {
  let state = nextSpotState("open", "claimed");
  state = nextSpotState(state, "proof_submitted");
  state = nextSpotState(state, "seller_paid");
  assert.equal(state, "settled");
});

test("auction outbid keeps the spot funded", () => {
  assert.equal(nextSpotState(nextSpotState("open", "bid_placed"), "outbid"), "funded");
});

test("dispute can be resolved, withdrawn or timed out", () => {
  assert.equal(nextSpotState("disputed", "dispute_resolved"), "settled");
  assert.equal(nextSpotState("disputed", "dispute_timed_out"), "refunded");
  assert.equal(nextSpotState("disputed", "dispute_withdrawn"), "funded");
  assert.equal(nextSpotState("disputed", "dispute_withdrawn", { proofSubmitted: true }), "delivered");
});

test("terminal states accept no events", () => {
  const events: SpotEvent[] = ["claimed", "bid_placed", "proof_submitted", "seller_paid", "refunded", "closed"];
  for (const state of terminalSpotStates) {
    for (const event of events) assert.equal(canTransition(state, event), false, `${state} via ${event}`);
  }
});

test("seller cannot be paid before proof", () => {
  assert.throws(() => nextSpotState("funded", "seller_paid"), InvalidTransitionError);
});

test("funded spots cannot be closed", () => {
  assert.throws(() => nextSpotState("funded", "closed"), InvalidTransitionError);
});
