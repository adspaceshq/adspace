"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import type { NotificationCategory } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { Skeleton } from "@/components/ui/Skeleton";

const CATEGORIES: Array<{ id: NotificationCategory; label: string; description: string }> = [
  { id: "sales", label: "sales", description: "someone claims one of your spots" },
  { id: "bidding", label: "bidding", description: "you're outbid on a spot" },
  { id: "delivery", label: "delivery", description: "proof posted, proof due soon, review window closing" },
  { id: "disputes", label: "disputes", description: "a dispute opens, is withdrawn or decided" },
  { id: "payments", label: "payments", description: "payouts and refunds land in your wallet" },
  { id: "listings", label: "listing review", description: "your listing is approved or needs changes" },
  { id: "messages", label: "messages", description: "new messages in a spot thread (at most hourly)" },
  { id: "reminders", label: "saved listings", description: "a listing you saved closes within a day" },
];

// Email only; everything always shows in the in-app bell.
export function NotificationPrefs() {
  const queryClient = useQueryClient();
  const prefs = useQuery({ queryKey: queryKeys.notificationPrefs, queryFn: () => api.me.notificationPrefs() });
  const save = useMutation({
    mutationFn: (patch: Partial<Record<NotificationCategory, boolean>>) => api.me.setNotificationPrefs(patch),
    onMutate: (patch) => {
      const previous = queryClient.getQueryData(queryKeys.notificationPrefs);
      queryClient.setQueryData(queryKeys.notificationPrefs, (current: Record<string, boolean> | undefined) => ({ ...current, ...patch }));
      return { previous };
    },
    onError: (_error, _patch, context) => queryClient.setQueryData(queryKeys.notificationPrefs, context?.previous),
    onSuccess: (data) => queryClient.setQueryData(queryKeys.notificationPrefs, data),
  });

  if (prefs.isPending) return <Skeleton className="h-48 w-full" />;
  return (
    <ul className="flex flex-col divide-y divide-line">
      {CATEGORIES.map((category) => {
        const on = prefs.data?.[category.id] !== false;
        return (
          <li key={category.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <p className="text-body font-medium">{category.label}</p>
              <p className="text-small text-muted">{category.description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={on}
              aria-label={`email me about ${category.label}`}
              onClick={() => save.mutate({ [category.id]: !on })}
              className={`relative h-6 w-11 shrink-0 cursor-pointer rounded-full transition-colors ${on ? "bg-ink" : "bg-line"}`}
            >
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
