"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SupportState } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import { queryKeys } from "@/lib/query";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { STATE_LABEL, TicketThread } from "@/components/help/TicketThread";

const STATES: Array<{ state: SupportState; label: string }> = [
  { state: "open", label: "waiting on us" },
  { state: "answered", label: "answered" },
  { state: "closed", label: "closed" },
];

// The team's support queue: requests waiting on us first, oldest first; a request opens with its context.
export function SupportTab() {
  const params = useSearchParams();
  const ticketId = params.get("ticket");
  const state = (STATES.some((entry) => entry.state === params.get("state")) ? params.get("state") : "open") as SupportState;
  const query = useQuery({ queryKey: queryKeys.supportQueue(state), queryFn: () => api.review.support(state), refetchInterval: 30_000, enabled: !ticketId });

  if (ticketId) {
    return (
      <div className="flex flex-col gap-4">
        <Link href={`/review?tab=support&state=${state}`} className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> all requests
        </Link>
        <TicketThread ticketId={ticketId} staff />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="request state" className="flex gap-1">
        {STATES.map((entry) => (
          <Link
            key={entry.state}
            href={`/review?tab=support&state=${entry.state}`}
            aria-current={entry.state === state ? "page" : undefined}
            className={cx(
              "rounded-full px-3 py-1.5 text-small font-medium",
              entry.state === state ? "bg-ink text-white" : "border border-line bg-surface text-muted hover:text-ink",
            )}
          >
            {entry.label}
          </Link>
        ))}
      </nav>
      {query.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : !query.data?.length ? (
        <EmptyState icon={CheckCircle2} title={state === "open" ? "no one is waiting" : "nothing here"} description={state === "open" ? "new support requests show up here, oldest first." : undefined} />
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {query.data.map((ticket) => (
            <li key={ticket.id}>
              <Link href={`/review?tab=support&state=${state}&ticket=${ticket.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink/5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{ticket.subject}</span>
                  <span className="block truncate text-small text-muted">
                    @{ticket.userHandle} · {ticket.topic} · {new Date(ticket.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <Badge tone={STATE_LABEL[ticket.state].tone}>{STATE_LABEL[ticket.state].text}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
