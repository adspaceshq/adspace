import { describe, expect, it } from "vitest";
import { formatExpiry, proposalExpiry } from "./squads-expiry";

describe("proposalExpiry", () => {
  const validUntil = "2027-01-15T08:00:00.000Z";
  const at = Date.parse(validUntil);

  it("is live up to and including valid_until, expired after it", () => {
    expect(proposalExpiry(validUntil, at - 60_000)).toEqual({ at: new Date(at), expired: false });
    expect(proposalExpiry(validUntil, at)?.expired).toBe(false);
    expect(proposalExpiry(validUntil, at + 1)?.expired).toBe(true);
  });

  it("has no expiry for proposals without valid_until or with a bad value", () => {
    expect(proposalExpiry(null, at)).toBeNull();
    expect(proposalExpiry(undefined, at)).toBeNull();
    expect(proposalExpiry("not a date", at)).toBeNull();
  });

  it("formats the expiry as a readable local time", () => {
    expect(formatExpiry(new Date(at))).toMatch(/2027/);
  });
});
