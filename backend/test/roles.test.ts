import assert from "node:assert/strict";
import { test } from "node:test";
import { hasRole, invalidRoleEntries } from "../src/v2/roles.js";

const user = { id: "6f918dc4-c59e-4801-b00d-ac2ac2a8c6eb", did: "did:privy:abc123" };

test("hasRole matches user id or Privy DID only", () => {
  assert.equal(hasRole(user, [user.id]), true);
  assert.equal(hasRole(user, [" did:privy:abc123 "]), true);
  assert.equal(hasRole(user, ["@alice", "alice", ""]), false);
  assert.equal(hasRole(user, []), false);
});

test("handles in role config are reported as invalid", () => {
  assert.deepEqual(invalidRoleEntries(["@x402__ai", user.id, "did:privy:abc", " "]), ["@x402__ai"]);
});
