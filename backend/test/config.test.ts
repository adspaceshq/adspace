import assert from "node:assert/strict";
import test from "node:test";
import request from "supertest";
import { loadConfig, adspacesProgramId } from "../src/config.js";
import { createApp } from "../src/index.js";
import type { AuthRepository } from "../src/db.js";

const auth: AuthRepository = {
  async createSession() { throw new Error("not used"); },
  async readSession() { return undefined; },
  async destroySession() {},
};

test("configuration validates backend and chain boundaries", () => {
  const config = loadConfig({
    DATABASE_URL: "postgresql://postgres:password@localhost:5432/adspaces",
    FRONTEND_URL: "https://app.adspaces.example/",
    PORT: "9000",
    DATABASE_POOL_SIZE: "12",
    SESSION_TTL_HOURS: "24",
    SOLANA_NETWORK: "devnet",
  });
  assert.equal(config.frontendUrl, "https://app.adspaces.example");
  assert.equal(config.port, 9000);
  assert.equal(config.databasePoolSize, 12);
  assert.equal(config.solana.programId, adspacesProgramId);
  assert.throws(() => loadConfig({ DATABASE_URL: "postgresql://localhost/db", SOLANA_NETWORK: "invalid" }), /SOLANA_NETWORK/);
  assert.throws(() => loadConfig({ DATABASE_URL: "postgresql://localhost/db", ADSPACES_PROGRAM_ID: "not-a-key" }), /ADSPACES_PROGRAM_ID/);
});

test("health reports chain integration state", async () => {
  const response = await request(createApp({
    auth,
    chain: { cluster: "devnet", programId: adspacesProgramId },
  })).get("/health").expect(200);
  assert.deepEqual(response.body.chain, {
    cluster: "devnet",
    programId: adspacesProgramId,
    integration: "disabled",
  });
});
