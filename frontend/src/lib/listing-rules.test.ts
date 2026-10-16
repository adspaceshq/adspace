import { describe, expect, it } from "vitest";
import { adminApprovalMessage, beyondHorizon, needsAdminApproval, proofWindow } from "./listing-rules";
import { resolveBlockedReason } from "./dispute-rules";

const NOW = Date.UTC(2026, 9, 8, 12);
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe("listing rules", () => {
  it("needs an admin past 90 days and refuses past 365", () => {
    expect(needsAdminApproval(NOW + 90 * DAY, NOW)).toBe(false);
    expect(needsAdminApproval(NOW + 90 * DAY + 1, NOW)).toBe(true);
    expect(needsAdminApproval(new Date(NOW + 120 * DAY).toISOString(), NOW, 150)).toBe(false);
    expect(needsAdminApproval("not a date", NOW)).toBe(false);
    expect(beyondHorizon(NOW + 365 * DAY, NOW)).toBe(false);
    expect(beyondHorizon(NOW + 365 * DAY + 1, NOW)).toBe(true);
    expect(adminApprovalMessage()).toBe("listings longer than 90 days need an admin to approve");
  });

  it("opens proof at artwork close, not at the listing deadline", () => {
    const listing = { artworkDueAt: new Date(NOW + HOUR).toISOString(), deliveryDueAt: new Date(NOW + 2 * DAY).toISOString() };
    expect(proofWindow(listing, NOW)).toBe("not_yet");
    expect(proofWindow(listing, NOW + HOUR)).toBe("open");
    expect(proofWindow(listing, NOW + 2 * DAY)).toBe("closed");
  });

  it("blocks a resolve after the timeout, and a multisig proposal within 6 hours of it", () => {
    const timeoutAt = new Date(NOW + 5 * HOUR).toISOString();
    expect(resolveBlockedReason(timeoutAt, false, NOW)).toBeNull();
    expect(resolveBlockedReason(timeoutAt, true, NOW)).toMatch(/only 5h 0m left .* at least 6 hours/);
    expect(resolveBlockedReason(new Date(NOW + 7 * HOUR).toISOString(), true, NOW)).toBeNull();
    expect(resolveBlockedReason(new Date(NOW - 1).toISOString(), false, NOW)).toMatch(/timed out/);
  });
});
