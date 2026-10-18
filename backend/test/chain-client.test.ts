import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { decodeChainError } from "../src/chain/errors.js";
import { associatedTokenAddress, createProgram, pdas } from "../src/chain/program.js";

const program = createProgram(new Connection("http://127.0.0.1:8899"));
const addresses = pdas(program.programId);

test("program id matches the deployed adspaces program", () => {
  assert.equal(program.programId.toBase58(), "8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5");
});

test("claim_spot instruction includes config in program account order", async () => {
  const buyer = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const listing = Keypair.generate().publicKey;
  const spot = addresses.spot(listing, 0);
  const instruction = await program.methods
    .claimSpot()
    .accountsStrict({
      buyer,
      listing,
      spot,
      vault: addresses.vault(spot),
      buyerAta: associatedTokenAddress(buyer, mint),
      config: addresses.config(),
      usdcMint: mint,
      tokenProgram: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
    })
    .instruction();
  assert.equal(instruction.keys.length, 8);
  assert.ok(instruction.keys[0].pubkey.equals(buyer));
  assert.ok(instruction.keys[5].pubkey.equals(addresses.config()));
});

test("program errors decode to their IDL message", () => {
  const selfDealing = program.idl.errors.find((error) => error.name === "selfDealing");
  assert.ok(selfDealing);
  const decoded = decodeChainError(new Error(`custom program error: 0x${selfDealing.code.toString(16)}`));
  assert.equal(decoded.programError?.toLowerCase(), "selfdealing");
  assert.equal(decoded.message, selfDealing.msg);
  assert.equal(decoded.status, 409);
});

test("the CertiK-fix program errors decode to friendly copy", () => {
  const cases: Array<[number, string, RegExp]> = [
    [6049, "InvalidRentPayer", /rent account is misconfigured/],
    [6050, "ArtworkWindowOpen", /proof opens when the artwork window closes/],
    [6051, "DisputeTimeoutPassed", /timed out, so it can't be resolved/],
    [6052, "SelfOutbid", /already the top bidder/],
    [6053, "DisputeMismatch", /made for an earlier dispute/],
    [6054, "SellerAccountRequired", /needs the creator's token account/],
    [6055, "AdminMessageExpired", /has expired .*rebuild it/],
    [6056, "ConfigMismatch", /settings changed since this admin action was built/],
    [6057, "DisputeWithdrawTooSoon", /opened a moment ago; try withdrawing again/],
    [6058, "ResolveAccountRequired", /missing a token account; rebuild the decision/],
  ];
  for (const [code, name, copy] of cases) {
    const hex = decodeChainError(new Error(`custom program error: 0x${code.toString(16)}`));
    assert.equal(hex.programError, name);
    assert.equal(hex.code, code);
    assert.match(hex.message, copy);
    const logged = decodeChainError(new Error("failed"), [`Program log: AnchorError occurred. Error Code: ${name}. Error Number: ${code}. Error Message: raw.`]);
    assert.match(logged.message, copy);
  }
});

test("network expiry maps to a retryable error", () => {
  assert.equal(decodeChainError(new Error("Blockhash not found")).status, 503);
});

test("Privy authorization failures become user-fixable errors", async () => {
  const { signingError } = await import("../src/chain/signers.js");
  const reconnect = signingError(new Error('401 {"error":"No valid authorization keys or user signing keys available"}')) as Error & { status?: number };
  assert.equal(reconnect.status, 409);
  assert.match(reconnect.message, /reconnect/);
  const config = signingError(new Error("Invalid wallet authorization private key")) as Error & { status?: number };
  assert.equal(config.status, 503);
  const other = new Error("blockhash not found");
  assert.equal(signingError(other), other);
});

test("balance failures say whether SOL or USDC is short and keep the raw error", () => {
  const sol = decodeChainError(new Error("Transfer: insufficient lamports 0, need 2039280"));
  assert.match(sol.message, /not enough SOL/);
  assert.match(sol.raw ?? "", /insufficient lamports/);
  const usdc = decodeChainError(new Error("failed"), ["Program log: Error: insufficient funds"]);
  assert.match(usdc.message, /not enough USDC/);
  assert.match(decodeChainError(new Error("Attempt to debit an account but found no record of a prior credit.")).message, /not enough SOL/);
});
