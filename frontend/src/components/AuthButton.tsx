'use client';

import { useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';

export interface XIdentity {
  ready: boolean;
  authenticated: boolean;
  handle: string | undefined;
  login: () => void;
}

/** X handle from the Privy user object (X-only login, no wallets). */
export function useXIdentity(): XIdentity {
  const { ready, authenticated, user, login } = usePrivy();
  const username = (user as unknown as { twitter?: { username?: string } })?.twitter?.username;
  return { ready, authenticated, handle: username ? `@${username}` : undefined, login };
}

/**
 * Mount this (only when NEXT_PUBLIC_PRIVY_APP_ID is set) to observe X login
 * state from a parent without calling usePrivy there — safe when Privy is
 * disabled because this component simply never mounts.
 */
export function XProbe({ onChange }: { onChange: (x: XIdentity) => void }) {
  const { ready, authenticated, handle, login } = useXIdentity();
  useEffect(() => {
    onChange({ ready, authenticated, handle, login });
    // Primitive deps only: login identity is stable; avoids effect loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, handle]);
  return null;
}

export default function AuthButton() {
  // Hooks below require PrivyProvider. Without an App ID the provider renders
  // bare children, so render nothing here instead of crashing prerender.
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID) return null;
  return <PrivyAuthButton />;
}

function PrivyAuthButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) {
    return (
      <span className="rounded-lg px-4 py-2 text-[13px] font-medium text-[#020817]/40">
        Loading…
      </span>
    );
  }

  if (!authenticated) {
    return (
      <button
        onClick={() => login()}
        className="rounded-lg bg-[#020817] px-4 py-2 text-[13px] font-medium text-white shadow-sm transition hover:-translate-y-px hover:bg-[#0f1a33]"
      >
        Log in
      </button>
    );
  }

  // X handle only — wallet display comes later with wallet login.
  const twitter = (user as unknown as { twitter?: { username?: string } })?.twitter?.username;
  const label = twitter ? `@${twitter}` : 'Connected';

  return (
    <span className="flex items-center gap-2">
      <span
        title={user?.id ?? ''}
        className="max-w-[160px] truncate rounded-full border border-[#e7e5e0] bg-white px-3 py-[6px] font-mono text-[12px] font-medium text-[#020817]"
      >
        {label}
      </span>
      <button
        onClick={() => logout()}
        className="rounded-lg px-3 py-2 text-[13px] font-medium text-[#020817]/60 transition hover:text-[#020817]"
      >
        Log out
      </button>
    </span>
  );
}
