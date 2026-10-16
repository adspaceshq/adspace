// The program refuses resolve_dispute from the timeout on, so the server won't open a Squads proposal
// with less than this left (mirrors SQUADS_RESOLVE_MIN_LEAD_MS in the backend).
export const SQUADS_MIN_LEAD_MS = 6 * 60 * 60 * 1000;

// Why a decision can't be sent now, or null when it can.
export function resolveBlockedReason(timeoutAt: string, viaMultisig: boolean, now: number): string | null {
  const left = new Date(timeoutAt).getTime() - now;
  if (left <= 0) return "this dispute has timed out, so it can't be resolved anymore. the sponsor can take a full refund.";
  if (viaMultisig && left < SQUADS_MIN_LEAD_MS) {
    const hours = Math.floor(left / 3_600_000);
    const minutes = Math.floor((left % 3_600_000) / 60_000);
    return `only ${hours}h ${minutes}m left before the timeout. a multisig proposal needs at least ${SQUADS_MIN_LEAD_MS / 3_600_000} hours to be approved and executed, so let it time out (full refund to the sponsor).`;
  }
  return null;
}
