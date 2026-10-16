"use client";

import { getAccessToken, getIdentityToken, useLinkAccount, useMfaEnrollment, usePrivy, useSigners, useUpdateAccount, useUser } from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, setCsrfToken } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { PRIVY_APP_ID } from "@/lib/privy";
import { queryKeys } from "@/lib/query";

export interface WalletAccess {
  // Gasless: the backend submits transactions for the user's embedded wallet via a Privy signer.
  delegated: boolean;
  mfaEnabled: boolean;
  enableGasless: () => Promise<void>;
  // Replaces the signer (e.g. after a key or policy change) so it carries the current policy.
  reconnectGasless: () => Promise<void>;
  setupMfa: () => void;
  // Signs a server-prepared transaction with the user's own wallet. Privy asks for two-factor here;
  // used for withdrawals, which the gasless signer's policy does not allow.
  signTransaction: (base64: string) => Promise<string>;
}

export interface SessionState {
  ready: boolean;
  session: Session | null;
  wallet: WalletAccess;
  signIn: () => void;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
  // Opens Privy's email code flow; the session picks up the verified email afterwards.
  // Resolves true once the email is verified and the session updated, false if the user backs out.
  linkEmail: () => Promise<boolean>;
  // Verifies the new address with a code before it replaces the old one.
  updateEmail: () => void;
  linkError?: string;
  // Privy is signed in but the adspaces session couldn't load (API down), as opposed to signed out.
  loadError: boolean;
}

const noWallet: WalletAccess = {
  delegated: false,
  mfaEnabled: false,
  enableGasless: async () => {},
  reconnectGasless: async () => {},
  setupMfa: () => {},
  signTransaction: async () => {
    throw new Error("sign in first");
  },
};

const guest: SessionState = {
  ready: true,
  session: null,
  wallet: noWallet,
  signIn: () => {},
  signOut: async () => {},
  refresh: async () => {},
  linkEmail: async () => false,
  updateEmail: () => {},
  loadError: false,
};

const SessionContext = createContext<SessionState>(guest);

export function useSession(): SessionState {
  return useContext(SessionContext);
}

async function exchangeSession(): Promise<Session> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new ApiError("sign in again", 401);
  const identityToken = (await getIdentityToken().catch(() => null)) ?? undefined;
  return api.auth.exchange(accessToken, identityToken);
}

// Reuse the v2 cookie session when present; otherwise trade the Privy tokens for one.
// Re-exchange when Privy holds an email the session hasn't seen (linked in another tab).
async function loadSession(privyEmail: string | undefined): Promise<Session> {
  try {
    const existing = await api.auth.me();
    if (!privyEmail || (existing.emailVerified && existing.email === privyEmail)) return existing;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  return exchangeSession();
}

function PrivySession({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const queryClient = useQueryClient();
  const { addSigners, removeSigners } = useSigners();
  const { wallets } = useWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();
  const { refreshUser } = useUser();
  const { showMfaEnrollmentModal } = useMfaEnrollment();

  const embedded = user?.linkedAccounts.find(
    (account) =>
      account.type === "wallet" && "chainType" in account && account.chainType === "solana" && "walletClientType" in account && account.walletClientType === "privy",
  ) as { address: string; delegated?: boolean } | undefined;
  const walletAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const mfaEnabled = (user?.mfaMethods?.length ?? 0) > 0;

  // The signer carries a Privy policy: it may only sign adspaces program instructions (plus creating
  // token accounts), never plain USDC transfers. Withdrawals therefore always need the user's own signature.
  const enableGasless = useCallback(async () => {
    const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
    const policyId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_ID;
    if (!walletAddress) throw new Error("your wallet is still being created; try again in a moment");
    if (!signerId) throw new Error("gasless transactions are not configured");
    await addSigners({ address: walletAddress, signers: [{ signerId, policyIds: policyId ? [policyId] : [] }] });
    await refreshUser();
  }, [addSigners, walletAddress, refreshUser]);

  const reconnectGasless = useCallback(async () => {
    if (!walletAddress) throw new Error("your wallet is still being created; try again in a moment");
    await removeSigners({ address: walletAddress });
    await enableGasless();
  }, [removeSigners, walletAddress, enableGasless]);

  const signTransaction = useCallback(
    async (base64: string) => {
      const target = wallets.find((item) => item.address === walletAddress);
      if (!target) throw new Error("your wallet isn't ready yet; try again in a moment");
      const { signedTransaction } = await privySignTransaction({
        transaction: Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)),
        wallet: target,
        chain: `solana:${ADSPACES_CLUSTER === "mainnet-beta" ? "mainnet" : ADSPACES_CLUSTER}` as never,
        // Our own confirm window already shows amount and destination; skip Privy's generic one.
        // Privy still asks for the user's two-factor code before signing.
        options: { uiOptions: { showWalletUIs: false } },
      });
      return btoa(String.fromCharCode(...signedTransaction));
    },
    [wallets, walletAddress, privySignTransaction],
  );

  const wallet = useMemo<WalletAccess>(
    () => ({ delegated, mfaEnabled, enableGasless, reconnectGasless, setupMfa: showMfaEnrollmentModal, signTransaction }),
    [delegated, mfaEnabled, enableGasless, reconnectGasless, showMfaEnrollmentModal, signTransaction],
  );

  const privyEmail = user?.email?.address;
  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => loadSession(privyEmail),
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

  const [linkError, setLinkError] = useState<string>();
  const resync = useCallback(async () => {
    queryClient.setQueryData(queryKeys.session, await exchangeSession());
  }, [queryClient]);
  // Settles the promise handed out by linkEmail once Privy's flow ends either way.
  const pendingLink = useRef<((linked: boolean) => void) | null>(null);
  const settleLink = useCallback((linked: boolean) => {
    pendingLink.current?.(linked);
    pendingLink.current = null;
  }, []);
  const resyncAndSettle = useCallback(async () => {
    try {
      await resync();
      settleLink(true);
    } catch {
      setLinkError("couldn't verify that email; try again");
      settleLink(false);
    }
  }, [resync, settleLink]);
  const { linkEmail: privyLinkEmail } = useLinkAccount({
    onSuccess: () => {
      setLinkError(undefined);
      void resyncAndSettle();
    },
    onError: (code) => {
      // Already linked in Privy: the session just needs to pull it in.
      if (code === "cannot_link_more_of_type") return void resyncAndSettle();
      if (code !== "exited_link_flow") setLinkError("couldn't verify that email; try again");
      settleLink(false);
    },
  });
  const linkEmail = useCallback(() => {
    settleLink(false);
    return new Promise<boolean>((resolve) => {
      pendingLink.current = resolve;
      privyLinkEmail();
    });
  }, [privyLinkEmail, settleLink]);

  const { updateEmail } = useUpdateAccount({
    onSuccess: () => {
      setLinkError(undefined);
      void resync();
    },
    onError: (code) => {
      if (code !== "exited_update_flow" && code !== "exited_link_flow") setLinkError("couldn't update your email; try again");
    },
  });

  const value = useMemo<SessionState>(
    () => ({
      ready: ready && (!authenticated || !query.isPending),
      session: authenticated ? (query.data ?? null) : null,
      wallet,
      signIn: () => login(),
      signOut,
      refresh,
      linkEmail,
      updateEmail,
      linkError,
      loadError: authenticated && query.isError,
    }),
    [ready, authenticated, query.isPending, query.isError, query.data, wallet, login, signOut, refresh, linkEmail, updateEmail, linkError],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <SessionContext.Provider value={guest}>{children}</SessionContext.Provider>;
  return <PrivySession>{children}</PrivySession>;
}
