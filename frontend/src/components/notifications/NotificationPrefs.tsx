"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import type { NotificationCategory } from "@/lib/api/types";
import { NOTIFICATION_CATEGORIES as CATEGORIES } from "@/lib/notification-categories";
import { queryKeys } from "@/lib/query";
import { Skeleton } from "@/components/ui/Skeleton";

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
              className={`relative block h-6 w-11 shrink-0 cursor-pointer rounded-full p-0 transition-colors ${on ? "bg-ink" : "bg-line-strong"}`}
            >
              <span aria-hidden className={`absolute left-0.5 top-0.5 block size-5 rounded-full bg-white shadow transition-transform ${on ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
