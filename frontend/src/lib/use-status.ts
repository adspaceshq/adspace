"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";

// Public protocol status. The server caches the on-chain pause flag for ~20s, so polling every 30s
// keeps the banner and the purchase buttons honest without loading the RPC.
export function useProtocolStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: () => api.status(),
    staleTime: 20_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}

// True only when the server says so; unknown (loading, unreachable) never blocks buying.
export function usePaused(): boolean {
  return useProtocolStatus().data?.paused === true;
}
