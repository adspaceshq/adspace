'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePrivy, useSigners, useUser } from '@privy-io/react-auth';
import { useCreateWallet as useCreateSolanaWallet } from '@privy-io/react-auth/solana';
import { createApiSession, fetchApiMe, logoutApiSession } from '@/lib/auth-api';
import { PRIVY_ENABLED } from '@/lib/privy';
import type { SessionUser } from '@/lib/types';

export interface AuthSession {
  ready: boolean;
  authenticated: boolean;
  /** Stable Adspaces user ID — compare this, never handles, for owner UI. */
  userId: string | undefined;
  /** Whether the platform allowlist names this user as a reviewer. */
  isReviewer: boolean;
  handle: string | undefined;
  name: string | undefined;
  avatar: string | undefined;
  email: string | undefined;
  walletAddress: string | undefined;
  walletDelegated: boolean;
  hasX: boolean;
  onboardingComplete: boolean;
  loggingIn: boolean;
  error: string | undefined;
  login: () => void;
  linkEmail: () => void;
  linkX: () => void;
  delegateWallet: () => Promise<void>;
  logout: () => Promise<void>;
}

const guest: AuthSession = {
  ready: true,
  authenticated: false,
  userId: undefined,
  isReviewer: false,
  handle: undefined,
  name: undefined,
  avatar: undefined,
  email: undefined,
  walletAddress: undefined,
  walletDelegated: false,
  hasX: false,
  onboardingComplete: false,
  loggingIn: false,
  error: undefined,
  login: () => {},
  linkEmail: () => {},
  linkX: () => {},
  delegateWallet: async () => {},
  logout: async () => {},
};

const AuthSessionContext = createContext<AuthSession>(guest);

export function useAuthSession(): AuthSession {
  return useContext(AuthSessionContext);
}

export default function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_ENABLED) {
    return <AuthSessionContext.Provider value={guest}>{children}</AuthSessionContext.Provider>;
  }
  return <PrivySessionProvider>{children}</PrivySessionProvider>;
}

function PrivySessionProvider({ children }: { children: React.ReactNode }) {
  const {
    ready,
    authenticated,
    user,
    login: privyLogin,
    linkEmail,
    linkTwitter,
    logout: privyLogout,
  } = usePrivy();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [exchanging, setExchanging] = useState(false);
  const exchangedFor = useRef<string | null>(null);
  const walletProvisionedFor = useRef<string | null>(null);
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();
  const { addSigners } = useSigners();
  const { refreshUser } = useUser();
  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  const embeddedWallet = user?.linkedAccounts.flatMap((account) => {
    if (account.type !== 'wallet'
      || !('address' in account)
      || !('chainType' in account)
      || !('walletClientType' in account)
      || account.chainType !== 'solana'
      || account.walletClientType !== 'privy') return [];
    return [{
      address: account.address,
      delegated: 'delegated' in account && Boolean(account.delegated),
    }];
  })[0];

  const exchange = useCallback(async () => {
    setExchanging(true);
    try {
      const session = await createApiSession();
      setMe(session);
      setError(undefined);
    } catch (e) {
      setMe(null);
      setError(
        e instanceof Error
          ? e.message
          : 'Privy login succeeded but the API rejected the session. Check the backend Privy configuration.',
      );
    } finally {
      setExchanging(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    void (async () => {
      if (!authenticated) {
        exchangedFor.current = null;
        setMe(null);
        return;
      }
      const did = user?.id ?? 'authed';
      try {
        const existing = exchangedFor.current === did ? null : await fetchApiMe().catch(() => null);
        const staleHandle = existing?.handle?.startsWith('user-') && !!user?.twitter?.username;
        const staleWallet = Boolean(existing?.walletAddress && embeddedWallet?.address && existing.walletAddress !== embeddedWallet.address);
        const stale = staleHandle || staleWallet;
        if (existing && !stale) {
          exchangedFor.current = did;
          setMe(existing);
          setError(undefined);
          return;
        }
        exchangedFor.current = did;
        await exchange();
      } catch {
        exchangedFor.current = did;
        await exchange();
      }
    })();
  }, [ready, authenticated, user, embeddedWallet?.address, exchange]);

  useEffect(() => {
    if (!authenticated || !me || embeddedWallet?.address || walletProvisionedFor.current === me.did) return;
    walletProvisionedFor.current = me.did;
    void createSolanaWallet()
      .catch(() => undefined)
      .then(exchange);
  }, [authenticated, me, embeddedWallet?.address, createSolanaWallet, exchange]);

  const walletDelegated = Boolean(embeddedWallet?.delegated);
  const walletAddress = embeddedWallet?.address ?? me?.walletAddress;
  const onboardingComplete = Boolean(me?.hasX && me.email && walletAddress && walletDelegated);

  const value: AuthSession = {
    ready: ready && !exchanging,
    authenticated: Boolean(authenticated && me?.hasX),
    userId: me?.id,
    isReviewer: me?.isReviewer ?? false,
    handle: me?.handle,
    name: me?.name ?? user?.twitter?.name ?? undefined,
    avatar: me?.avatar ?? user?.twitter?.profilePictureUrl ?? undefined,
    email: me?.email,
    walletAddress,
    walletDelegated,
    hasX: me?.hasX ?? false,
    onboardingComplete,
    loggingIn: exchanging,
    error,
    login: () => {
      setError(undefined);
      privyLogin();
    },
    linkEmail,
    linkX: linkTwitter,
    delegateWallet: async () => {
      setError(undefined);
      try {
        if (!embeddedWallet?.address) throw new Error('Privy wallet is not ready');
        if (!signerId) throw new Error('NEXT_PUBLIC_PRIVY_SIGNER_ID is not configured');
        await addSigners({ address: embeddedWallet.address, signers: [{ signerId }] });
        await refreshUser();
        await exchange();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not enable gasless transactions.');
      }
    },
    logout: async () => {
      exchangedFor.current = null;
      walletProvisionedFor.current = null;
      setMe(null);
      try {
        await logoutApiSession();
      } catch {
        // cookie may already be gone
      }
      await privyLogout();
    },
  };

  return (
    <AuthSessionContext.Provider value={value}>
      {children}
      {authenticated && me && !onboardingComplete && <ProfileCompletionModal auth={value} />}
    </AuthSessionContext.Provider>
  );
}

function ProfileCompletionModal({ auth }: { auth: AuthSession }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="complete-profile-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4166fb]">One last step</p>
        <h2 id="complete-profile-title" className="mt-2 text-2xl font-semibold text-[#020817]">Complete your profile</h2>
        <p className="mt-2 text-sm leading-6 text-[#526079]">Verify your contact details and prepare your embedded Solana wallet for Adspaces transactions.</p>
        <div className="mt-6 space-y-3">
          <ProfileRequirement complete={auth.hasX} label="X account" actionLabel="Connect X" onAction={auth.linkX} />
          <ProfileRequirement complete={Boolean(auth.email)} label="Verified email" actionLabel="Add email" onAction={auth.linkEmail} />
          <ProfileRequirement complete={Boolean(auth.walletAddress)} label="Privy Solana wallet" pendingLabel="Creating wallet…" />
          <ProfileRequirement complete={auth.walletDelegated} label="Gasless transactions" actionLabel="Enable" onAction={() => void auth.delegateWallet()} />
        </div>
        {auth.error && <p className="mt-4 text-sm text-red-600">{auth.error}</p>}
        <button type="button" onClick={() => void auth.logout()} className="mt-5 text-sm text-[#526079] underline underline-offset-4">Log out</button>
      </div>
    </div>
  );
}

function ProfileRequirement({
  complete,
  label,
  actionLabel,
  pendingLabel,
  onAction,
}: {
  complete: boolean;
  label: string;
  actionLabel?: string;
  pendingLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-[#e7e5e0] p-4">
      <span className="text-sm font-medium text-[#020817]">{label}</span>
      {complete ? (
        <span className="text-sm font-semibold text-emerald-700">Ready</span>
      ) : onAction && actionLabel ? (
        <button type="button" onClick={onAction} className="rounded-lg bg-[#020817] px-3 py-2 text-sm font-medium text-white">{actionLabel}</button>
      ) : (
        <span className="text-sm text-[#526079]">{pendingLabel}</span>
      )}
    </div>
  );
}
