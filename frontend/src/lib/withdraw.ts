import { isAddress } from "@solana/kit";
import type { Withdrawal } from "@/lib/api/types";
import { toBaseUnits } from "@/lib/money";

// Mirrors the backend default: a rolling 24-hour cap per user.
export const DAILY_WITHDRAWAL_LIMIT = 1_000_000_000n;
const DAY_MS = 24 * 60 * 60 * 1000;

export function usedInLastDay(history: Withdrawal[], now: number): bigint {
  return history
    .filter((item) => item.state !== "failed" && now - new Date(item.createdAt).getTime() < DAY_MS)
    .reduce((sum, item) => sum + BigInt(item.amount), 0n);
}

export function withdrawable(balance: bigint, used: bigint): bigint {
  const remaining = DAILY_WITHDRAWAL_LIMIT - used;
  return remaining < 0n ? 0n : balance < remaining ? balance : remaining;
}

export type WithdrawErrors = Partial<Record<"destination" | "amount", string>>;

export function validateWithdrawal(input: { destination: string; amount: string; ownAddress?: string; balance: bigint; used: bigint }): WithdrawErrors {
  const errors: WithdrawErrors = {};
  const destination = input.destination.trim();
  if (!destination) errors.destination = "paste a Solana wallet address";
  else {
    // A base58 string that decodes to 32 bytes, as the program and the server expect.
    if (!isAddress(destination)) errors.destination = "that isn't a valid Solana address";
    else if (destination === input.ownAddress) errors.destination = "that's your adspaces wallet; send to a different one";
  }
  let amount: bigint;
  try {
    amount = BigInt(toBaseUnits(input.amount));
  } catch (error) {
    return { ...errors, amount: (error as Error).message };
  }
  if (amount <= 0n) errors.amount = "enter an amount above zero";
  else if (amount > input.balance) errors.amount = "that's more than your balance";
  else if (amount + input.used > DAILY_WITHDRAWAL_LIMIT) errors.amount = "that's over your 24-hour limit";
  return errors;
}
