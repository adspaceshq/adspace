import type { SessionUser } from "../types.js";

// Reviewer/admin roles match only immutable identifiers: the adspaces user id or the Privy DID.
// Never handles: users without X choose their own handle, so a configured handle could be claimed.
export function hasRole(user: Pick<SessionUser, "id" | "did">, entries: readonly string[]): boolean {
  return entries.some((entry) => {
    const clean = entry.trim();
    return clean.length > 0 && (clean === user.id || clean === user.did);
  });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Config entries that can never match (e.g. "@handle"), so misconfiguration is visible at startup.
export function invalidRoleEntries(entries: readonly string[]): string[] {
  return entries.map((entry) => entry.trim()).filter((entry) => entry && !UUID.test(entry) && !entry.startsWith("did:privy:"));
}
