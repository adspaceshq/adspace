import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Keypair } from "@solana/web3.js";
import type { PrivyClient } from "@privy-io/node";
import type { Db } from "../src/db/client.js";
import type { SessionUser } from "../src/types.js";
import { createChainContext } from "../src/v2/chain-context.js";
import { createTestDb } from "./helpers/db.js";

let db: Db;
let close: () => Promise<void>;
let keypairFile: string;

before(async () => {
  ({ db, close } = await createTestDb());
  keypairFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "adspaces-test-")), "reviewer.json");
  fs.writeFileSync(keypairFile, JSON.stringify(Array.from(Keypair.generate().secretKey)));
});
after(async () => {
  await close();
  fs.rmSync(path.dirname(keypairFile), { recursive: true, force: true });
});

const wallet = Keypair.generate().publicKey.toBase58();
const user: SessionUser = { id: "u1", did: "did:privy:u1", handle: "@u1", walletAddress: wallet, hasX: true };

function context(account: { delegated: boolean; mfa: number }) {
  const privy = {
    users: () => ({
      _get: async () => ({
        linked_accounts: [
          { type: "wallet", chain_type: "solana", address: wallet, wallet_client_type: "privy", id: "wallet-1", delegated: account.delegated },
        ],
        mfa_methods: Array.from({ length: account.mfa }, () => ({ type: "totp" })),
      }),
    }),
  } as unknown as PrivyClient;
  return createChainContext({
    db,
    privy,
    rpcUrl: "http://127.0.0.1:8899",
    mint: Keypair.generate().publicKey.toBase58(),
    reviewerKeypairPath: keypairFile,
    privyAuthorizationKey: "test-key",
  });
}

test("withdrawals require two-factor authentication", async () => {
  await assert.rejects(context({ delegated: true, mfa: 0 }).userSigner(user, { requireMfa: true }), (error: Error & { status?: number }) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /two-factor/);
    return true;
  });
  const signer = await context({ delegated: true, mfa: 1 }).userSigner(user, { requireMfa: true });
  assert.equal(signer.publicKey.toBase58(), wallet);
});

test("other actions only need gasless delegation", async () => {
  const signer = await context({ delegated: true, mfa: 0 }).userSigner(user);
  assert.equal(signer.publicKey.toBase58(), wallet);
  await assert.rejects(context({ delegated: false, mfa: 1 }).userSigner(user), /gasless/);
});
