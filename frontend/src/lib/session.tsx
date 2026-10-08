"use client";

import { getAccessToken, getIdentityToken, usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { api, ApiError, setCsrfToken } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { PRIVY_APP_ID } from "@/lib/privy";
import { queryKeys } from "@/lib/query";

export interface SessionState {
  ready: boolean;
  session: Session | null;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const guest: SessionState = {
  ready: true,
  session: null,
  signIn: () => {},
  signOut: async () => {},
  refresh: async () => {},
};

const SessionContext = createContext<SessionState>(guest);

export function useSession(): SessionState {
  return useContext(SessionContext);
}

// Reuse the v2 cookie session when present; otherwise trade the Privy tokens for one.
async function loadSession(): Promise<Session> {
  try {
    return await api.auth.me();
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  const accessToken = await getAccessToken();
  if (!accessToken) throw new ApiError("sign in again", 401);
  const identityToken = (await getIdentityToken().catch(() => null)) ?? undefined;
  return api.auth.exchange(accessToken, identityToken);
}

function PrivySession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout } = usePrivy();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: loadSession,
    enabled: ready && authenticated,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    setCsrfToken(query.data?.csrfToken);
  }, [query.data?.csrfToken]);

  const signOut = useCallback(async () => {
    await api.auth.logout().catch(() => undefined);
    setCsrfToken(undefined);
    queryClient.clear();
    await logout();
  }, [logout, queryClient]);

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }, [queryClient]);

  const value = useMemo<SessionState>(
    () => ({
      ready: ready && (!authenticated || !query.isPending),
      session: authenticated ? (query.data ?? null) : null,
      signIn: () => login(),
      signOut,
      refresh,
    }),
    [ready, authenticated, query.isPending, query.data, login, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <SessionContext.Provider value={guest}>{children}</SessionContext.Provider>;
  return <PrivySession>{children}</PrivySession>;
}
