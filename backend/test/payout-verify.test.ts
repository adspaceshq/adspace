import assert from "node:assert/strict";
import test from "node:test";
import {
  explorerTxUrl,
  isSignatureLike,
  resolvePayoutReference,
  usdcMintFor,
  verifyPayoutTx,
} from "../src/payout.js";

const SIG = "5".repeat(88);
const DEST = "7xKXtg2CW87d97TXJSDV7iSNL4w8Bvqf9f4kR3mP6jD";
const MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

function rpcStub(opts: { credited: number; err?: unknown; found?: boolean }) {
  return (async () =>
    new Response(
      JSON.stringify(
        opts.found === false
          ? { jsonrpc: "2.0", id: 1, result: null }
          : {
              jsonrpc: "2.0",
              id: 1,
              result: {
                meta: {
                  err: opts.err ?? null,
                  preTokenBalances: [],
                  postTokenBalances: [
                    { mint: MINT, owner: DEST, uiTokenAmount: { uiAmount: opts.credited } },
                  ],
                },
              },
            },
      ),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;
}

test("signature shape + mint + explorer helpers", () => {
  assert.equal(isSignatureLike(SIG), true);
  assert.equal(isSignatureLike("sent via Phantom"), false);
  assert.equal(isSignatureLike(""), false);
  assert.equal(usdcMintFor("devnet", MINT), MINT);
  assert.throws(() => usdcMintFor("devnet"), /USDC_MINT is required/);
  assert.equal(explorerTxUrl(SIG, "devnet"), `https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  assert.equal(explorerTxUrl(SIG, "mainnet-beta"), `https://explorer.solana.com/tx/${SIG}`);
});

test("lenient mode keeps legacy memo refs; strict mode requires a signature", async () => {
  const memo = await resolvePayoutReference({
    reference: "sent via Phantom",
    destination: DEST,
    expectedNet: 10,
    env: { PAYOUT_REQUIRE_ONCHAIN: "0" } as NodeJS.ProcessEnv,
  });
  assert.equal(memo, "sent via Phantom");

  await assert.rejects(
    resolvePayoutReference({
      reference: "sent via Phantom",
      destination: DEST,
      expectedNet: 10,
      env: { PAYOUT_REQUIRE_ONCHAIN: "1" } as NodeJS.ProcessEnv,
    }),
    /transaction signature/,
  );
  await assert.rejects(
    resolvePayoutReference({
      reference: "x".repeat(201),
      destination: DEST,
      expectedNet: 10,
      env: {} as NodeJS.ProcessEnv,
    }),
    /at most 200/,
  );
});

test("sig-like refs verify on-chain when an RPC is configured", async () => {
  const rpcUrl = "https://rpc.example";
  await resolvePayoutReference({
    reference: SIG,
    destination: DEST,
    expectedNet: 10,
    rpcUrl,
    mint: MINT,
    fetchFn: rpcStub({ credited: 10 }),
    env: {} as NodeJS.ProcessEnv,
  });
  await assert.rejects(
    resolvePayoutReference({
      reference: SIG,
      destination: DEST,
      expectedNet: 10,
      rpcUrl,
      mint: MINT,
      fetchFn: rpcStub({ credited: 4.2 }),
      env: {} as NodeJS.ProcessEnv,
    }),
    /does not credit/,
  );
});

test("verifyPayoutTx rejects missing, failed, and wrong-destination transfers", async () => {
  const base = { signature: SIG, destination: DEST, expectedNet: 10, cluster: "devnet" as const, rpcUrl: "https://rpc.example", mint: MINT };
  await assert.rejects(verifyPayoutTx({ ...base, fetchFn: rpcStub({ credited: 10, found: false }) }), /not found/);
  await assert.rejects(verifyPayoutTx({ ...base, fetchFn: rpcStub({ credited: 10, err: "err" }) }), /failed on-chain/);
  await assert.rejects(verifyPayoutTx({ ...base, fetchFn: rpcStub({ credited: 9.5 }) }), /does not credit/);
});
