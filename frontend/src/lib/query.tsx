"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError } from "@/lib/api/v2";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Client errors won't fix themselves; only retry network and server failures.
            retry: (failures, error) => !(error instanceof ApiError && error.status < 500) && failures < 2,
          },
          mutations: { retry: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

// Central query keys so mutations invalidate the right views.
export const queryKeys = {
  session: ["session"] as const,
  listings: (filters: Record<string, unknown> = {}) => ["listings", filters] as const,
  listing: (slug: string) => ["listing", slug] as const,
  posts: (listingId: string) => ["posts", listingId] as const,
  myListings: ["me", "listings"] as const,
  creatorDashboard: ["dashboard", "creator"] as const,
  sponsorDashboard: ["dashboard", "sponsor"] as const,
  earnings: (days: number) => ["earnings", days] as const,
  activity: ["activity"] as const,
  spot: (spotId: string) => ["spot", spotId] as const,
  timeline: (spotId: string) => ["timeline", spotId] as const,
  messages: (spotId: string) => ["messages", spotId] as const,
  withdrawals: ["withdrawals"] as const,
  watchlist: ["me", "watchlist"] as const,
  reviewQueue: ["review", "queue"] as const,
  reviewSummary: ["review", "summary"] as const,
  adminStatus: ["admin", "status"] as const,
  profile: (handle: string) => ["profile", handle] as const,
};
