import assert from "node:assert/strict";
import { test } from "node:test";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { decodeChainError } from "../src/chain/errors.js";
import { associatedTokenAddress, createProgram, pdas } from "../src/chain/program.js";

const program = createProgram(new Connection("http://127.0.0.1:8899"));
const addresses = pdas(program.programId);

test("program id matches the deployed adspaces program", () => {
  assert.equal(program.programId.toBase58(), "6ft49ExLRbHUcY6crReW7qibZLrS5rdCudKWQRp2LMSW");
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

test("network expiry maps to a retryable error", () => {
  assert.equal(decodeChainError(new Error("Blockhash not found")).status, 503);
});
