"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import type { WatchItem } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { userErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ToastProvider";

// One cached list drives every save button; toggles update it optimistically.
export function useWatchlist() {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: queryKeys.watchlist, queryFn: () => api.me.watchlist(), enabled: Boolean(session?.onboarding), staleTime: 60_000 });
  const ids = new Set((query.data ?? []).map((item) => item.listing.id));

  const toggle = useMutation({
    mutationFn: ({ listingId, watching }: { listingId: string; watching: boolean }) => (watching ? api.me.watch(listingId) : api.me.unwatch(listingId)),
    onMutate: async ({ listingId, watching }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.watchlist });
      const previous = queryClient.getQueryData<WatchItem[]>(queryKeys.watchlist);
      if (!watching) queryClient.setQueryData<WatchItem[]>(queryKeys.watchlist, (items) => items?.filter((item) => item.listing.id !== listingId));
      return { previous };
    },
    onError: (error, { watching }, context) => {
      queryClient.setQueryData(queryKeys.watchlist, context?.previous);
      toast.error(watching ? "couldn't save that listing" : "couldn't remove that listing", userErrorMessage(error));
    },
    onSuccess: (_data, { watching }) => toast.success(watching ? "saved to your watchlist" : "removed from your watchlist"),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlist }),
  });

  return { items: query.data, isPending: query.isPending && Boolean(session?.onboarding), ids, toggle, enabled: Boolean(session?.onboarding) };
}
