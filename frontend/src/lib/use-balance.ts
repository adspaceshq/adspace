"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api/v2";

// The signed-in user's USDC balance in base units, read by the backend with its own RPC
// (public RPCs rate-limit browsers, and a paid key must not ship to the client).
// `needed`: while the balance is below it (checkout short of funds), poll fast so a top-up shows quickly.
export function useUsdcBalance(owner: string | undefined, { needed }: { needed?: bigint | null } = {}) {
  return useQuery({
    queryKey: ["balance", owner],
    queryFn: async () => (await api.me.balance()).usdc,
    enabled: Boolean(owner),
    refetchInterval: (query) => {
      const data = query.state.data;
      return needed != null && data !== undefined && BigInt(data) < needed ? 5_000 : 30_000;
    },
    refetchIntervalInBackground: false,
    retry: 2,
  });
}
