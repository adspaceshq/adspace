"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";

// Latest page plus the unread count; polled so the bell stays current.
export function useNotifications() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const enabled = Boolean(session?.onboarding);
  const query = useQuery({
    queryKey: queryKeys.notifications,
    queryFn: () => api.me.notifications(),
    enabled,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.me.markRead(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
  return { enabled, data: query.data, isPending: query.isPending && enabled, markRead };
}
