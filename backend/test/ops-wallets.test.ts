import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeWallets, WALLET_LEVELS } from "../src/services/ops-wallets.js";

test("a key with several roles is one row with the strictest levels", () => {
  const wallets = mergeWallets([
    { address: "A", role: "fee_payer" },
    { address: "A", role: "reviewer" },
    { address: "A", role: "proposer" },
    { address: "V", role: "config_authority" },
    { address: "V", role: "treasury" },
    { address: "V", role: "treasury" },
    { address: "G", role: "guardian" },
  ]);
  assert.deepEqual(wallets, [
    { address: "A", roles: ["fee_payer", "reviewer", "proposer"], minSol: WALLET_LEVELS.fee_payer.min, targetSol: WALLET_LEVELS.fee_payer.target },
    { address: "V", roles: ["config_authority", "treasury"], minSol: WALLET_LEVELS.config_authority.min, targetSol: WALLET_LEVELS.config_authority.target },
    { address: "G", roles: ["guardian"], minSol: WALLET_LEVELS.guardian.min, targetSol: WALLET_LEVELS.guardian.target },
  ]);
});

test("levels can be overridden, as the fee payer's minimum is from MIN_FEE_PAYER_LAMPORTS", () => {
  const levels = { ...WALLET_LEVELS, fee_payer: { min: 2, target: 3 } };
  assert.equal(mergeWallets([{ address: "A", role: "fee_payer" }], levels)[0].minSol, 2);
});

test("every role has a target at or above its minimum", () => {
  for (const [role, level] of Object.entries(WALLET_LEVELS)) assert.ok(level.target >= level.min, role);
});
