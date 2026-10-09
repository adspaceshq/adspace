export interface WeekBucket {
  start: Date;
  end: Date;
  earned: bigint;
}

const DAY = 24 * 60 * 60 * 1000;

function weekStartUtc(time: number): number {
  const date = new Date(time);
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - day * DAY;
}

// Daily payout rows -> `weeks` Monday-start UTC buckets ending with the current week; empty weeks are 0.
export function bucketByWeek(rows: Array<{ day: string; earned: string }>, now: number, weeks = 13): WeekBucket[] {
  const lastStart = weekStartUtc(now);
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, index) => {
    const start = lastStart - (weeks - 1 - index) * 7 * DAY;
    return { start: new Date(start), end: new Date(start + 6 * DAY), earned: 0n };
  });
  const firstStart = buckets[0].start.getTime();
  for (const row of rows) {
    const time = Date.parse(`${row.day}T00:00:00Z`);
    if (Number.isNaN(time) || time < firstStart) continue;
    const index = Math.floor((weekStartUtc(time) - firstStart) / (7 * DAY));
    if (index >= 0 && index < weeks) buckets[index].earned += BigInt(row.earned);
  }
  return buckets;
}

// A "nice" axis maximum (1, 2, 2.5, 5 x 10^n) at or above the largest value, in whole dollars.
export function niceCeiling(maxDollars: number): number {
  if (maxDollars <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(maxDollars));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * magnitude >= maxDollars) return step * magnitude;
  }
  return 10 * magnitude;
}
