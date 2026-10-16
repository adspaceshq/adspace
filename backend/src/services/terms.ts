import type { Db } from "../db/client.js";
import { termsAcceptances } from "../db/schema.js";

export class TermsError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export type TermsContext = "onboarding" | "claim" | "bid";

// The client sends the terms version the user saw and agreed to. Missing means they never agreed;
// a different version means the page they agreed on is out of date.
export function assertCurrentTerms(accepted: unknown, current: string): string {
  if (typeof accepted !== "string" || !accepted.trim()) throw new TermsError("agree to the terms to continue", 400);
  if (accepted.trim() !== current) throw new TermsError("the terms have changed. reload the page and review them", 409);
  return current;
}

// Accepts a Db or an open transaction (same insert API).
export async function recordTermsAcceptance(
  db: Pick<Db, "insert">,
  entry: { userId: string; context: TermsContext; termsVersion: string; spotId?: string; at?: Date },
) {
  await db.insert(termsAcceptances).values({
    userId: entry.userId,
    context: entry.context,
    termsVersion: entry.termsVersion,
    spotId: entry.spotId ?? null,
    acceptedAt: entry.at ?? new Date(),
  });
}
