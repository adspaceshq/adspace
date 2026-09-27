'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLoginWithOAuth, usePrivy } from '@privy-io/react-auth';
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
  loggingIn: boolean;
  error: string | undefined;
  login: () => void;
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
  loggingIn: false,
  error: undefined,
  login: () => {},
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
  const { ready, authenticated, user, logout: privyLogout } = usePrivy();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [exchanging, setExchanging] = useState(false);
  const exchangedFor = useRef<string | null>(null);

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
          : 'X login reached Privy but the API rejected the session. Set PRIVY_APP_SECRET on the backend.',
      );
    } finally {
      setExchanging(false);
    }
  }, []);

  const { initOAuth, loading } = useLoginWithOAuth({
    onComplete: () => {
      void exchange();
    },
    onError: (err) => {
      setError(err ? String(err) : 'X login failed. Enable Twitter in the Privy dashboard.');
    },
  });

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
        const stale = existing?.handle?.startsWith('user-') && !!user?.twitter?.username;
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
  }, [ready, authenticated, user?.id, user?.twitter?.username, exchange]);

  const value: AuthSession = {
    ready: ready && !exchanging,
    authenticated: Boolean(authenticated && me?.handle),
    userId: me?.id,
    isReviewer: me?.isReviewer ?? false,
    handle: me?.handle,
    name: me?.name ?? user?.twitter?.name ?? undefined,
    avatar: me?.avatar ?? user?.twitter?.profilePictureUrl ?? undefined,
    loggingIn: loading || exchanging,
    error,
    login: () => {
      setError(undefined);
      void initOAuth({ provider: 'twitter' });
    },
    logout: async () => {
      exchangedFor.current = null;
      setMe(null);
      try {
        await logoutApiSession();
      } catch {
        // cookie may already be gone
      }
      await privyLogout();
    },
  };

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}
