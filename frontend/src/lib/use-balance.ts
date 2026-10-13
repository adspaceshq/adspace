"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";

// The signed-in user's USDC balance in base units, read by the backend with its own RPC
// (public RPCs rate-limit browsers, and a paid key must not ship to the client).
export function useUsdcBalance(owner: string | undefined) {
  return useQuery({
    queryKey: ["balance", owner],
    queryFn: async () => (await api.me.balance()).usdc,
    enabled: Boolean(owner),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });
}
