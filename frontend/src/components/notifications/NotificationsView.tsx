"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Settings } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { useNow } from "@/lib/use-now";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { NotificationItem } from "./NotificationItem";

const PAGE = 30;

export function NotificationsView() {
  const queryClient = useQueryClient();
  const now = useNow(60_000);
  const query = useInfiniteQuery({
    queryKey: [...queryKeys.notifications, "all"],
    queryFn: ({ pageParam }) => api.me.notifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.items.length === PAGE ? last.items.at(-1)?.createdAt : undefined),
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.me.markRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const unread = query.data?.pages[0]?.unread ?? 0;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-title font-semibold sm:text-display">notifications</h1>
          <p className="text-body text-muted">{unread ? `${unread} unread` : "you're all caught up."}</p>
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <Button variant="secondary" size="sm" onClick={() => markRead.mutate(undefined)} loading={markRead.isPending}>
              mark all read
            </Button>
          )}
          <Link href="/settings#notifications" className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-small font-medium hover:border-line-strong">
            <Settings className="size-4" aria-hidden /> email settings
          </Link>
        </div>
      </div>
      {query.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <EmptyState icon={Bell} title="no notifications yet" description="claims, bids, proofs, disputes and payouts land here and in your inbox." />
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {items.map((item) => (
              <li key={item.id}>
                <NotificationItem item={item} now={now} onOpen={() => !item.readAt && markRead.mutate([item.id])} />
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <Button variant="secondary" className="self-center" onClick={() => void query.fetchNextPage()} loading={query.isFetchingNextPage}>
              load older
            </Button>
          )}
        </>
      )}
    </div>
  );
}
