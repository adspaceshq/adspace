'use client';

import { useEffect } from 'react';
import { useAuthSession, type AuthSession } from '@/components/AuthSessionProvider';
import { PRIVY_ENABLED } from '@/lib/privy';

export type XIdentity = AuthSession;

/** Backend-verified X identity (Privy OAuth + API session). */
export function useXIdentity(): XIdentity {
  return useAuthSession();
}

export function XProbe({ onChange }: { onChange: (x: XIdentity) => void }) {
  const x = useXIdentity();
  useEffect(() => {
    onChange(x);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x.ready, x.authenticated, x.handle, x.name, x.avatar, x.loggingIn, x.error]);
  return null;
}

export default function AuthButton() {
  if (!PRIVY_ENABLED) return null;
  return <PrivyAuthButton />;
}

function PrivyAuthButton() {
  const { ready, authenticated, handle, avatar, loggingIn, error, login, logout } = useAuthSession();

  if (!ready && !authenticated) {
    return (
      <button
        type="button"
        disabled
        aria-label="Log in with X"
        className="rounded-lg border border-[#e7e5e0] bg-white px-4 py-2 text-[13px] font-medium text-[#020817]/40"
      >
        Log in with X
      </button>
    );
  }

  if (!authenticated) {
    return (
      <span className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={login}
          disabled={loggingIn}
          aria-label="Log in with X"
          className="rounded-lg border border-[#e7e5e0] bg-white px-4 py-2 text-[13px] font-medium text-[#020817] shadow-sm transition hover:-translate-y-px hover:border-[#c3cdfd] hover:bg-[#f8f8ff] disabled:cursor-wait disabled:opacity-60"
        >
          {loggingIn ? 'Connecting…' : 'Log in with X'}
        </button>
        {error && <span className="max-w-[240px] text-right text-[11px] text-[#dc2626]">{error}</span>}
      </span>
    );
  }

  const label = handle ?? 'Connected';

  return (
    <span className="flex items-center gap-2">
      <span
        title={handle ?? ''}
        className="flex max-w-[180px] items-center gap-2 truncate rounded-full border border-[#e7e5e0] bg-white py-[4px] pl-[5px] pr-3 font-mono text-[12px] font-medium text-[#020817]"
      >
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} alt="" width={22} height={22} className="h-[22px] w-[22px] rounded-full object-cover" />
        ) : (
          <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[#4166fb] text-[10px] font-semibold text-white">
            {label.replace('@', '').charAt(0).toUpperCase()}
          </span>
        )}
        {label}
      </span>
      <button
        type="button"
        onClick={() => void logout()}
        className="rounded-lg px-3 py-2 text-[13px] font-medium text-[#020817]/60 transition hover:text-[#020817]"
      >
        Log out
      </button>
    </span>
  );
}
