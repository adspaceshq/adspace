"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { activityLabel, groupByDay } from "@/lib/activity";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { useNow } from "@/lib/use-now";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Tabs } from "@/components/ui/Tabs";
import { Address } from "@/components/ui/Address";
import { userErrorMessage } from "@/lib/errors";

const PAGE = 30;
type Role = "creator" | "sponsor" | undefined;

export function ActivityView() {
  const param = useSearchParams().get("role");
  const role: Role = param === "creator" || param === "sponsor" ? param : undefined;
  const now = useNow(60_000);
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.activity, "all", role ?? "any"],
    queryFn: ({ pageParam }) => api.me.activity({ role, limit: PAGE, before: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.createdAt : undefined),
  });
  const items = query.data?.pages.flat() ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-title font-semibold sm:text-display">activity</h1>
        <p className="text-body text-muted">every claim, bid, delivery and payment on your spots, with on-chain receipts.</p>
      </div>
      <Tabs
        active={`/activity${role ? `?role=${role}` : ""}`}
        items={[
          { href: "/activity", label: "all" },
          { href: "/activity?role=creator", label: "selling" },
          { href: "/activity?role=sponsor", label: "sponsoring" },
        ]}
      />
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : query.isError ? (
        <p className="text-body text-danger">{userErrorMessage(query.error, "couldn't load your activity. try again.")}</p>
      ) : items.length === 0 ? (
        <EmptyState icon={History} title="nothing here yet" description="claims, bids, proofs and payouts show up as they happen." />
      ) : (
        <div className="flex flex-col gap-6">
          {groupByDay(items, now).map((group) => (
            <section key={group.day} className="flex flex-col gap-2">
              <h2 className="text-small font-medium text-muted">{group.day}</h2>
              <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {group.items.map((item) => (
                  <li key={item.id}>
                    <div className="flex items-center gap-3 px-4 py-3 text-small">
                      <span aria-hidden className={`size-2 shrink-0 rounded-full ${item.role === "creator" ? "bg-accent" : "bg-ink"}`} />
                      <Link href={`/dashboard/spots/${item.spotId}`} className="min-w-0 flex-1 hover:underline">
                        <p className="truncate">
                          <span className="font-medium">{activityLabel(item.type)}</span>
                          <span className="text-muted"> · spot {item.spotIndex + 1} · {item.role === "creator" ? "selling" : "sponsoring"}</span>
                        </p>
                        <p className="truncate text-muted">{item.listingTitle}</p>
                      </Link>
                      <time dateTime={item.createdAt} className="shrink-0 text-subtle">
                        {new Date(item.createdAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                      </time>
                      {item.signature && <Address value={item.signature} kind="tx" className="hidden text-subtle sm:inline-flex" />}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {query.hasNextPage && (
            <Button variant="secondary" className="self-center" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              load older
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
