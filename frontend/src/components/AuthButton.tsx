'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuthSession, type AuthSession } from '@/components/AuthSessionProvider';
import { PRIVY_ENABLED } from '@/lib/privy';
import { sellerUrl } from '@/lib/listings';

export type XIdentity = AuthSession;

/** Backend-verified Privy identity and API session. */
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
  const { ready, authenticated, handle, avatar, loggingIn, error, login } = useAuthSession();

  if (!ready && !authenticated) {
    return (
      <button
        type="button"
        disabled
        aria-label="Log in"
        className="rounded-lg border border-[#e7e5e0] bg-white px-4 py-2 text-[13px] font-medium text-[#020817]/40"
      >
        Log in
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
          aria-label="Log in"
          className="rounded-lg border border-[#e7e5e0] bg-white px-4 py-2 text-[13px] font-medium text-[#020817] shadow-sm transition hover:-translate-y-px hover:border-[#c3cdfd] hover:bg-[#f8f8ff] disabled:cursor-wait disabled:opacity-60"
        >
          {loggingIn ? 'Connecting…' : 'Log in'}
        </button>
        {error && <span className="max-w-[240px] text-right text-[11px] text-[#dc2626]">{error}</span>}
      </span>
    );
  }

  const label = handle ?? 'Connected';

  return (
    <Link
      href={sellerUrl(handle ?? 'seller')}
      title={handle ?? ''}
      aria-label={`View ${label} profile`}
      className="block shrink-0 overflow-hidden rounded-full ring-1 ring-black/10 transition hover:ring-2 hover:ring-[#4166fb]"
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover" />
      ) : (
        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#4166fb] text-sm font-semibold text-white">
          {label.replace('@', '').charAt(0).toUpperCase()}
        </span>
      )}
    </Link>
  );
}
