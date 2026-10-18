// Admin proposals (resume, dispute timeout) carry valid_until: the program refuses them once the cluster
// clock passes it, so an approved but unexecuted proposal can't overwrite newer settings later. Past that
// time the proposal is dead and has to be rebuilt from the current settings.
export interface ProposalExpiry {
  at: Date;
  expired: boolean;
}

export function proposalExpiry(validUntil: string | null | undefined, now: number): ProposalExpiry | null {
  if (!validUntil) return null;
  const at = new Date(validUntil);
  if (Number.isNaN(at.getTime())) return null;
  // The program still accepts the message in the second of valid_until itself.
  return { at, expired: now > at.getTime() };
}

export function formatExpiry(at: Date): string {
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
