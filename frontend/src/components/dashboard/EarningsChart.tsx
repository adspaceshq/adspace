"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import { bucketByWeek, niceCeiling } from "@/lib/earnings";
import { formatUsd } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useNow } from "@/lib/use-now";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

const WEEKS = 13;
const shortDate = (date: Date) =>
  date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
const dollars = (value: bigint) => Number(value / 10_000n) / 100;

// Weekly creator payouts over 13 weeks. Single series, so no legend: the title names it.
export function EarningsChart() {
  const now = useNow(60 * 60_000);
  const query = useQuery({
    queryKey: queryKeys.earnings(WEEKS * 7),
    queryFn: () => api.me.earnings(WEEKS * 7),
  });
  const weeks = bucketByWeek(query.data ?? [], now, WEEKS);
  const total = weeks.reduce((sum, week) => sum + week.earned, 0n);
  const ceiling = niceCeiling(
    Math.max(...weeks.map((week) => dollars(week.earned))),
  );
  const ticks = [ceiling, ceiling / 2, 0];

  return (
    <Card className="relative flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-body font-semibold">earnings</h2>
        <p className="text-small text-muted">paid out, last {WEEKS} weeks</p>
      </div>
      {query.isPending ? (
        <Skeleton className="h-52 w-full" />
      ) : (
        <>
          <p className="text-display font-semibold leading-none tabular-nums">
            {formatUsd(total)}
          </p>
          <div className="flex gap-3">
            <div
              className="relative h-40 w-10 shrink-0 text-right text-caption text-subtle tabular-nums"
              aria-hidden
            >
              {ticks.map((tick, index) => (
                <span
                  key={tick}
                  className="absolute right-0 -translate-y-1/2"
                  style={{ top: `${(index / (ticks.length - 1)) * 100}%` }}
                >
                  ${tick.toLocaleString()}
                </span>
              ))}
            </div>
            <div className="relative flex-1">
              <div
                className="pointer-events-none absolute inset-0 flex flex-col justify-between"
                aria-hidden
              >
                {ticks.map((tick) => (
                  <span key={tick} className="h-px w-full bg-line" />
                ))}
              </div>
              <div
                className="relative flex h-40 items-end justify-between"
                role="img"
                aria-label={`weekly earnings, ${formatUsd(total)} total over ${WEEKS} weeks`}
              >
                {weeks.map((week) => {
                  const height =
                    ceiling > 0 ? (dollars(week.earned) / ceiling) * 100 : 0;
                  const label = `${shortDate(week.start)} – ${shortDate(week.end)}: ${formatUsd(week.earned)}`;
                  return (
                    <div
                      key={week.start.toISOString()}
                      tabIndex={0}
                      aria-label={label}
                      className="group relative flex h-full flex-1 cursor-default items-end justify-center px-px outline-none"
                    >
                      <div
                        className="w-full max-w-6 rounded-t bg-accent transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                        style={{
                          height: week.earned > 0n ? `max(${height}%, 2px)` : 0,
                        }}
                      />
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full z-10 mb-2 hidden w-max rounded-control bg-ink px-2.5 py-1.5 text-caption text-white shadow-pop group-hover:block group-focus-visible:block"
                      >
                        <span className="block text-white/70">
                          {shortDate(week.start)} – {shortDate(week.end)}
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatUsd(week.earned)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div
                className="mt-2 flex justify-between text-caption text-subtle"
                aria-hidden
              >
                <span>{shortDate(weeks[0].start)}</span>
                <span>{shortDate(weeks[Math.floor(WEEKS / 2)].start)}</span>
                <span>this week</span>
              </div>
            </div>
          </div>
          {/* A table ignores sr-only's 1px size and would lay its rows out below the page (an extra
              page scrollbar), so the 1px box wraps it. */}
          <div className="sr-only">
            <table>
              <caption>weekly earnings</caption>
              <thead>
                <tr>
                  <th scope="col">week starting</th>
                  <th scope="col">earned</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week) => (
                  <tr key={week.start.toISOString()}>
                    <td>{shortDate(week.start)}</td>
                    <td>{formatUsd(week.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}
