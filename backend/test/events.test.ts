import assert from "node:assert/strict";
import { test } from "node:test";
import anchor, { BorshCoder, type Idl } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { eventAmount, eventCoder, eventString, programEvents } from "../src/chain/events.js";
import { createProgram } from "../src/chain/program.js";

const { BN } = anchor;
const program = createProgram(new Connection("http://127.0.0.1:8899"));
const coder = eventCoder(program.idl as Idl);

// Logs of a real devnet transaction (program before the DisputeResolved decision_uri/decided_at fields) (program before the DisputeResolved decision_uri/decided_at fields) in which a Squads multisig executed resolve_dispute, so our
// program ran as an inner instruction.
const squadsExecuteLogs = [
  "Program ComputeBudget111111111111111111111111111111 invoke [1]",
  "Program ComputeBudget111111111111111111111111111111 success",
  "Program ComputeBudget111111111111111111111111111111 invoke [1]",
  "Program ComputeBudget111111111111111111111111111111 success",
  "Program SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf invoke [1]",
  "Program log: Instruction: VaultTransactionExecute",
  "Program 8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5 invoke [2]",
  "Program log: Instruction: ResolveDispute",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [3]",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 76 of 137682 compute units",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [3]",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 76 of 135858 compute units",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [3]",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 76 of 134034 compute units",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [3]",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 118 of 132262 compute units",
  "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
  "Program data: eUD5mYuA7LtNS/wx0sfTssiR1bUjKUpN05bm04n4WDaO2HvQdp1bYAAUDJNiz41/pARNfVTAZSw92CudT09MEwTWeiEaQhN41tx903w8W0rU25kImDug1tft/Cul7nrAekcqybnAGgWj8wp0A4YFaalqFfG8BgQckKrnHv/Y+e4Ivo2marAXj7CIEyChBwAAAAAATHAHAAAAAADUMAAAAAAAAA==",
  "Program 8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5 consumed 36053 of 165253 compute units",
  "Program 8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5 success",
  "Program SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf consumed 72157 of 199700 compute units",
  "Program SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf success"
];

test("reads a pre-upgrade DisputeResolved (shorter layout) when our program runs inside a Squads execution", () => {
  const events = programEvents(squadsExecuteLogs, program.programId.toBase58(), coder);
  const resolved = events.find((event) => event.name === "DisputeResolved" || event.name === "disputeResolved");
  assert.ok(resolved, "DisputeResolved should be found");
  const data = resolved.data as Record<string, { toString(): string }>;
  assert.equal(data.buyerRefund.toString(), "500000");
  assert.equal(data.sellerAmount.toString(), "487500");
  assert.equal(data.fee.toString(), "12500");
});

test("ignores data logged by other programs", () => {
  const logs = ["Program Other1111111111111111111111111111111111 invoke [1]", ...squadsExecuteLogs.filter((line) => line.startsWith("Program data: ")), "Program Other1111111111111111111111111111111111 success"];
  assert.deepEqual(programEvents(logs, program.programId.toBase58(), coder), []);
});

// Encodes an event the way the program emits it: discriminator, then the Borsh struct.
function encodeEvent(name: string, data: Record<string, unknown>) {
  const borsh = new BorshCoder(program.idl as Idl);
  const event = program.idl.events!.find((item) => item.name.toLowerCase() === name.toLowerCase())!;
  return Buffer.concat([Buffer.from(event.discriminator), borsh.types.encode(event.name, data)]).toString("base64");
}

const wrap = (data: string) => [
  `Program ${program.programId.toBase58()} invoke [1]`,
  `Program data: ${data}`,
  `Program ${program.programId.toBase58()} success`,
];

test("reads the decision URI and time of a current DisputeResolved, with no treasury account", () => {
  const data = encodeEvent("DisputeResolved", {
    listing: Keypair.generate().publicKey,
    index: 2,
    dispute: Keypair.generate().publicKey,
    resolver: Keypair.generate().publicKey,
    decisionHash: Array(32).fill(7),
    sellerShareBps: 0,
    buyerRefund: new BN(1_000_000),
    sellerAmount: new BN(0),
    fee: new BN(0),
    treasuryAta: PublicKey.default,
    decisionUri: "https://adspaces.fun/a/b#decision-3",
    decidedAt: new BN(1_760_000_000),
  });
  const [event] = programEvents(wrap(data), program.programId.toBase58(), coder);
  const fields = event.data as Record<string, unknown>;
  assert.equal(eventAmount(fields, "buyerRefund", "buyer_refund"), 1_000_000n);
  assert.equal(eventString(fields, "decisionUri", "decision_uri"), "https://adspaces.fun/a/b#decision-3");
  assert.equal(eventAmount(fields, "decidedAt", "decided_at"), 1_760_000_000n);
  assert.ok((fields.treasuryAta ?? fields.treasury_ata) instanceof PublicKey);
});

test("reads the evidence URI and snapshotted timeout of a current DisputeRaised", () => {
  const data = encodeEvent("DisputeRaised", {
    listing: Keypair.generate().publicKey,
    index: 0,
    dispute: Keypair.generate().publicKey,
    buyer: Keypair.generate().publicKey,
    proofSubmitted: true,
    evidenceHash: Array(32).fill(1),
    raisedAt: new BN(1_760_000_000),
    evidenceUri: "https://adspaces.fun/a/b#dispute-1",
    timeoutSeconds: new BN(259_200),
  });
  const [event] = programEvents(wrap(data), program.programId.toBase58(), coder);
  const fields = event.data as Record<string, unknown>;
  assert.equal(eventString(fields, "evidenceUri", "evidence_uri"), "https://adspaces.fun/a/b#dispute-1");
  assert.equal(eventAmount(fields, "timeoutSeconds", "timeout_seconds"), 259_200n);
});

test("an undecodable program data line is skipped instead of hiding the other events", () => {
  const logs = [...wrap(Buffer.from("not an event at all, but long enough").toString("base64")), ...squadsExecuteLogs];
  const events = programEvents(logs, program.programId.toBase58(), coder);
  assert.equal(events.length, 1);
  // The pre-upgrade event has no decision URI: readers see it as missing.
  assert.equal(eventString(events[0].data as Record<string, unknown>, "decisionUri", "decision_uri"), null);
});
