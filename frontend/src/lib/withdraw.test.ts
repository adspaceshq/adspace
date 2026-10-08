import { describe, expect, it } from "vitest";
import type { Withdrawal } from "@/lib/api/types";
import { DAILY_WITHDRAWAL_LIMIT, usedInLastDay, validateWithdrawal, withdrawable } from "./withdraw";

const now = Date.parse("2026-10-08T12:00:00Z");
const row = (amount: string, hoursAgo: number, state: Withdrawal["state"] = "confirmed"): Withdrawal => ({
  id: amount,
  userId: "u",
  amount,
  destination: "d",
  state,
  chainTxId: null,
  signature: null,
  createdAt: new Date(now - hoursAgo * 3_600_000).toISOString(),
  updatedAt: new Date(now).toISOString(),
});
const address = "AoYvgLNGRvMAYv52gMfHa5Cg2PBzEpHzrCvBAPpAWWqQ";
const base = { destination: address, amount: "10", balance: 50_000_000n, used: 0n };

describe("withdraw", () => {
  it("counts only live withdrawals from the last 24 hours", () => {
    expect(usedInLastDay([row("100", 1), row("200", 30), row("400", 2, "failed"), row("50", 23)], now)).toBe(150n);
  });

  it("caps the withdrawable amount by balance and the daily limit", () => {
    expect(withdrawable(5n, 0n)).toBe(5n);
    expect(withdrawable(DAILY_WITHDRAWAL_LIMIT * 2n, 100n)).toBe(DAILY_WITHDRAWAL_LIMIT - 100n);
    expect(withdrawable(10n, DAILY_WITHDRAWAL_LIMIT + 1n)).toBe(0n);
  });

  it("validates destination and amount", () => {
    expect(validateWithdrawal(base)).toEqual({});
    expect(validateWithdrawal({ ...base, destination: "nope" }).destination).toMatch(/valid/);
    expect(validateWithdrawal({ ...base, ownAddress: address }).destination).toMatch(/your adspaces wallet/);
    expect(validateWithdrawal({ ...base, amount: "60" }).amount).toMatch(/balance/);
    expect(validateWithdrawal({ ...base, amount: "0" }).amount).toMatch(/above zero/);
    expect(validateWithdrawal({ ...base, used: DAILY_WITHDRAWAL_LIMIT }).amount).toMatch(/24-hour/);
    expect(validateWithdrawal({ ...base, amount: "1.1234567" }).amount).toBeDefined();
  });
});
