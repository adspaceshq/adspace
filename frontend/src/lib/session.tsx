"use client";

import { getAccessToken, getIdentityToken, useMfa, useMfaEnrollment, usePrivy, useSigners, useUser } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { api, ApiError, setCsrfToken } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { PRIVY_APP_ID } from "@/lib/privy";
import { queryKeys } from "@/lib/query";

export interface WalletAccess {
  // Gasless: the backend submits transactions for the user's embedded wallet via a Privy signer.
  delegated: boolean;
  mfaEnabled: boolean;
  enableGasless: () => Promise<void>;
  setupMfa: () => void;
  // Asks for a fresh two-factor check; required right before withdrawals.
  verifyMfa: () => Promise<void>;
}

export interface SessionState {
  ready: boolean;
  session: Session | null;
  wallet: WalletAccess;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const noWallet: WalletAccess = {
  delegated: false,
  mfaEnabled: false,
  enableGasless: async () => {},
  setupMfa: () => {},
  verifyMfa: async () => {},
};

const guest: SessionState = {
  ready: true,
  session: null,
  wallet: noWallet,
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
  const { ready, authenticated, login, logout, user } = usePrivy();
  const queryClient = useQueryClient();
  const { addSigners } = useSigners();
  const { refreshUser } = useUser();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { promptMfa } = useMfa();

  const embedded = user?.linkedAccounts.find(
    (account) =>
      account.type === "wallet" && "chainType" in account && account.chainType === "solana" && "walletClientType" in account && account.walletClientType === "privy",
  ) as { address: string; delegated?: boolean } | undefined;
  const walletAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const mfaEnabled = (user?.mfaMethods?.length ?? 0) > 0;

  const enableGasless = useCallback(async () => {
    const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
    if (!walletAddress) throw new Error("your wallet is still being created; try again in a moment");
    if (!signerId) throw new Error("gasless transactions are not configured");
    await addSigners({ address: walletAddress, signers: [{ signerId }] });
    await refreshUser();
  }, [addSigners, walletAddress, refreshUser]);

  const wallet = useMemo<WalletAccess>(
    () => ({ delegated, mfaEnabled, enableGasless, setupMfa: showMfaEnrollmentModal, verifyMfa: promptMfa }),
    [delegated, mfaEnabled, enableGasless, showMfaEnrollmentModal, promptMfa],
  );

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
      wallet,
      signIn: () => login(),
      signOut,
      refresh,
    }),
    [ready, authenticated, query.isPending, query.data, wallet, login, signOut, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <SessionContext.Provider value={guest}>{children}</SessionContext.Provider>;
  return <PrivySession>{children}</PrivySession>;
}
