export interface DisputeDeadlineSource {
  // On-chain deadlines per spot address (opened_at + the timeout captured when the dispute was raised).
  readDeadlines?: (spotAddresses: string[]) => Promise<Array<Date | null>>;
  // Current config timeout; the fallback when the chain can't be read.
  timeoutSeconds: number;
}

// When each open dispute refunds the sponsor in full if nobody resolves it. Prefers the chain, which
// holds the timeout captured at raise; falls back to the DB open time plus the current config timeout.
export async function disputeDeadlines(
  rows: Array<{ openedAt: Date; spotAddress: string | null }>,
  source: DisputeDeadlineSource,
): Promise<Date[]> {
  const addresses = rows.map((row) => row.spotAddress).filter((address): address is string => Boolean(address));
  const onChain = new Map<string, Date | null>();
  if (source.readDeadlines && addresses.length) {
    try {
      const deadlines = await source.readDeadlines(addresses);
      addresses.forEach((address, index) => onChain.set(address, deadlines[index] ?? null));
    } catch (error) {
      console.error("reading dispute deadlines failed:", error instanceof Error ? error.message : error);
    }
  }
  return rows.map(
    (row) => (row.spotAddress ? onChain.get(row.spotAddress) : null) ?? new Date(row.openedAt.getTime() + source.timeoutSeconds * 1000),
  );
}
