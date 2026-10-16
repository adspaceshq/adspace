"use client";

import {
  getAccessToken,
  getIdentityToken,
  useConnectWallet,
  useLinkAccount,
  useMfaEnrollment,
  usePrivy,
  useSigners,
  useUpdateAccount,
  useUser,
} from "@privy-io/react-auth";
import { useSignTransaction, useWallets } from "@privy-io/react-auth/solana";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import PrivyAppProvider from "@/components/PrivyAppProvider";
import { api, ApiError, setCsrfToken } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { queryKeys } from "@/lib/query";
import type { BridgedSession, ExternalWalletAccess, PrivyBridgeProps, WalletAccess } from "@/lib/session";

// Everything that touches Privy lives in this module, which session.tsx loads on demand (see there).

const SOLANA_CHAIN = `solana:${ADSPACES_CLUSTER === "mainnet-beta" ? "mainnet" : ADSPACES_CLUSTER}` as const;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));

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

export default function PrivyBridge(props: PrivyBridgeProps) {
  return (
    <PrivyAppProvider>
      <PrivySession {...props} />
    </PrivyAppProvider>
  );
}

function PrivySession({ onChange, loginRequested, onLoginHandled }: PrivyBridgeProps) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const queryClient = useQueryClient();
  const { addSigners, removeSigners } = useSigners();
  const { wallets } = useWallets();
  const { signTransaction: privySignTransaction } = useSignTransaction();
  const { refreshUser } = useUser();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  // Privy's hooks hand back new functions and arrays on every render. Callbacks read them from this
  // ref so the session object below only changes when real data changes; otherwise handing it to
  // the parent re-renders this bridge and loops forever.
  const hooks = { addSigners, removeSigners, wallets, privySignTransaction, refreshUser, showMfaEnrollmentModal, login, logout };
  const live = useRef(hooks);
  live.current = hooks;

  const embedded = user?.linkedAccounts.find(
    (account) =>
      account.type === "wallet" && "chainType" in account && account.chainType === "solana" && "walletClientType" in account && account.walletClientType === "privy",
  ) as { address: string; delegated?: boolean } | undefined;
  const walletAddress = embedded?.address;
  const delegated = Boolean(embedded?.delegated);
  const mfaEnabled = (user?.mfaMethods?.length ?? 0) > 0;

  // Sign in was pressed before Privy loaded: open the login modal as soon as Privy is ready.
  useEffect(() => {
    if (!ready || !loginRequested) return;
    onLoginHandled();
    if (!authenticated) login();
  }, [ready, loginRequested, authenticated, login, onLoginHandled]);

  // The signer carries a Privy policy: it may only sign adspaces program instructions (plus creating
  // token accounts), never plain USDC transfers. Withdrawals therefore always need the user's own signature.
  const enableGasless = useCallback(async () => {
    const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
    const policyId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_POLICY_ID;
    if (!walletAddress) throw new Error("your wallet is still being created; try again in a moment");
    if (!signerId) throw new Error("gasless transactions are not configured");
    await live.current.addSigners({ address: walletAddress, signers: [{ signerId, policyIds: policyId ? [policyId] : [] }] });
    await live.current.refreshUser();
  }, [walletAddress]);

  const reconnectGasless = useCallback(async () => {
    if (!walletAddress) throw new Error("your wallet is still being created; try again in a moment");
    await live.current.removeSigners({ address: walletAddress });
    await enableGasless();
  }, [walletAddress, enableGasless]);

  const signTransaction = useCallback(
    async (base64: string) => {
      const target = live.current.wallets.find((item) => item.address === walletAddress);
      if (!target) throw new Error("your wallet isn't ready yet; try again in a moment");
      const { signedTransaction } = await live.current.privySignTransaction({
        transaction: fromBase64(base64),
        wallet: target,
        chain: SOLANA_CHAIN as never,
        // Our own confirm window already shows amount and destination; skip Privy's generic one.
        // Privy still asks for the user's two-factor code before signing.
        options: { uiOptions: { showWalletUIs: false } },
      });
      return toBase64(signedTransaction);
    },
    [walletAddress],
  );

  const setupMfa = useCallback(() => live.current.showMfaEnrollmentModal(), []);
  const wallet = useMemo<WalletAccess>(
    () => ({ delegated, mfaEnabled, enableGasless, reconnectGasless, setupMfa, signTransaction }),
    [delegated, mfaEnabled, enableGasless, reconnectGasless, setupMfa, signTransaction],
  );

  // External wallets, for the pause guardian in the ops panel.
  const pendingConnect = useRef<{ resolve: (address: string | null) => void; reject: (error: Error) => void } | null>(null);
  const settleConnect = useCallback((result: string | null | Error) => {
    const pending = pendingConnect.current;
    pendingConnect.current = null;
    if (result instanceof Error) pending?.reject(result);
    else pending?.resolve(result);
  }, []);
  const { connectWallet: privyConnectWallet } = useConnectWallet({
    onSuccess: ({ wallet: connected }) => settleConnect(connected.type === "solana" ? connected.address : null),
    // Closing the modal isn't an error worth showing.
    onError: (error) => settleConnect(String(error).includes("exited") ? null : new Error("couldn't connect that wallet. try again.")),
  });
  const connectLive = useRef(privyConnectWallet);
  connectLive.current = privyConnectWallet;
  const addressesKey = wallets.map((item) => item.address).join(",");
  const external = useMemo<ExternalWalletAccess>(
    () => ({
      addresses: addressesKey ? addressesKey.split(",") : [],
      connect: (description) => {
        settleConnect(null);
        return new Promise<string | null>((resolve, reject) => {
          pendingConnect.current = { resolve, reject };
          connectLive.current({ walletChainType: "solana-only", walletList: ["phantom", "detected_solana_wallets", "solflare", "backpack"], description });
        });
      },
      sign: async (address, base64) => {
        const target = live.current.wallets.find((item) => item.address === address);
        if (!target) throw new Error("connect the wallet first");
        const { signedTransaction } = await live.current.privySignTransaction({ transaction: fromBase64(base64), wallet: target, chain: SOLANA_CHAIN });
        return toBase64(signedTransaction);
      },
      disconnect: async (address) => {
        await live.current.wallets
          .find((item) => item.address === address)
          ?.disconnect()
          .catch(() => undefined);
      },
    }),
    [addressesKey, settleConnect],
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
    await live.current.logout();
  }, [queryClient]);

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
  const { linkEmail: privyLinkEmailNow } = useLinkAccount({
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
  const linkLive = useRef(privyLinkEmailNow);
  linkLive.current = privyLinkEmailNow;
  const linkEmail = useCallback(() => {
    settleLink(false);
    return new Promise<boolean>((resolve) => {
      pendingLink.current = resolve;
      linkLive.current();
    });
  }, [settleLink]);

  const { updateEmail: privyUpdateEmail } = useUpdateAccount({
    onSuccess: () => {
      setLinkError(undefined);
      void resync();
    },
    onError: (code) => {
      if (code !== "exited_update_flow" && code !== "exited_link_flow") setLinkError("couldn't update your email; try again");
    },
  });

  const updateLive = useRef(privyUpdateEmail);
  updateLive.current = privyUpdateEmail;
  const updateEmail = useCallback(() => updateLive.current(), []);
  const signIn = useCallback(() => live.current.login(), []);
  const value = useMemo<BridgedSession>(
    () => ({
      ready: ready && (!authenticated || !query.isPending),
      session: authenticated ? (query.data ?? null) : null,
      wallet,
      external,
      signIn,
      signOut,
      refresh,
      linkEmail,
      updateEmail,
      linkError,
      loadError: authenticated && query.isError,
    }),
    [ready, authenticated, query.isPending, query.isError, query.data, wallet, external, signIn, signOut, refresh, linkEmail, updateEmail, linkError],
  );

  useEffect(() => onChange(value), [value, onChange]);

  return null;
}
