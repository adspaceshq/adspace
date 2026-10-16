import assert from "node:assert/strict";
import { test } from "node:test";
import { BorshCoder } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import { programEvents } from "../src/chain/events.js";
import { createProgram } from "../src/chain/program.js";

const program = createProgram(new Connection("http://127.0.0.1:8899"));
const coder = new BorshCoder(program.idl);

// Logs of a real devnet transaction in which a Squads multisig executed resolve_dispute, so our
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

test("reads our program's events when it runs inside a Squads execution", () => {
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
