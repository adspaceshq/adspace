'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLinkAccount, useMfaEnrollment, usePrivy, useSigners, useUser } from '@privy-io/react-auth';
import type { PrivyErrorCode } from '@privy-io/react-auth';
import { useCreateWallet as useCreateSolanaWallet } from '@privy-io/react-auth/solana';
import { ApiError, createApiSession, fetchApiMe, logoutApiSession, saveOnboarding } from '@/lib/auth-api';
import { PRIVY_ENABLED } from '@/lib/privy';
import { BRAND_CATEGORIES, SOCIAL_PLATFORMS } from '@/lib/types';
import type { AccountType, BrandCategory, Onboarding, SessionUser, SocialPlatform } from '@/lib/types';

export interface AuthSession {
  ready: boolean;
  /** Privy may be authenticated while the backend session is recovering. */
  privyAuthenticated: boolean;
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
  mfaEnabled: boolean;
  hasX: boolean;
  onboardingComplete: boolean;
  /** creator | sponsor once chosen; undefined until the role step is done. */
  accountType: AccountType | undefined;
  loggingIn: boolean;
  error: string | undefined;
  login: (options?: { method?: 'twitter' | 'google' | 'email' } | React.MouseEvent<any>) => void;
  linkEmail: () => void;
  linkX: () => void;
  delegateWallet: () => Promise<void>;
  setupMfa: () => void;
  logout: () => Promise<void>;
}

/** Privy error codes → copy the user can act on. Closing the modal is not a failure. */
function linkErrorMessage(error: PrivyErrorCode | string): string | undefined {
  switch (error) {
    case 'exited_link_flow':
      return undefined;
    case 'cannot_link_more_of_type':
      return 'That account is already linked to your profile.';
    case 'linked_to_another_user':
      return 'That account is already linked to a different Adspaces user.';
    case 'too_many_requests':
      return 'Too many attempts. Try again in a minute.';
    default:
      return `Could not link that account (${error}).`;
  }
}

const guest: AuthSession = {
  ready: true,
  privyAuthenticated: false,
  authenticated: false,
  userId: undefined,
  isReviewer: false,
  handle: undefined,
  name: undefined,
  avatar: undefined,
  email: undefined,
  walletAddress: undefined,
  walletDelegated: false,
  mfaEnabled: false,
  hasX: false,
  onboardingComplete: false,
  accountType: undefined,
  loggingIn: false,
  error: undefined,
  login: () => {},
  linkEmail: () => {},
  linkX: () => {},
  delegateWallet: async () => {},
  setupMfa: () => {},
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
    logout: privyLogout,
  } = usePrivy();
  const [me, setMe] = useState<SessionUser | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [exchanging, setExchanging] = useState(false);
  const exchangedFor = useRef<string | null>(null);
  const walletProvisionedFor = useRef<string | null>(null);
  const syncedAccountsFor = useRef<string | null>(null);
  const { createWallet: createSolanaWallet } = useCreateSolanaWallet();
  const { addSigners } = useSigners();
  const { refreshUser } = useUser();
  const signerId = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;
  const { showMfaEnrollmentModal } = useMfaEnrollment();
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
      exchangedFor.current = null;
      setMe(null);
      if (e instanceof ApiError && e.status === 401) {
        await privyLogout();
      }
      setError(
        e instanceof Error
          ? e.message
          : 'Privy login succeeded but the API rejected the session. Check the backend Privy configuration.',
      );
    } finally {
      setExchanging(false);
    }
  }, [privyLogout]);

  /**
   * Privy can hold accounts our API session predates (linked in another tab, or
   * linked without our noticing), and linking never touches the session row.
   * Re-exchange so the profile step reflects what Privy actually has — calling
   * `linkEmail`/`linkTwitter` again would fail with "already has an account of
   * type … linked".
   */
  const resync = useCallback(async () => {
    exchangedFor.current = user?.id ?? 'authed';
    await exchange();
  }, [exchange, user?.id]);

  /**
   * Privy's link calls return void and surface failures as rejected promises
   * inside its own modal flow — an uncaught rejection there lands in the Next
   * error overlay. `useLinkAccount` gives us the success/error callbacks so a
   * failed or redundant link is a message, not a crash.
   */
  const { linkEmail: privyLinkEmail, linkTwitter: privyLinkTwitter } = useLinkAccount({
    onSuccess: () => {
      setError(undefined);
      void resync();
    },
    onError: (error) => {
      setError(linkErrorMessage(error));
      // Privy already holds the account (e.g. linked in another tab): the
      // session row just needs the same account pulled in.
      if (error === 'cannot_link_more_of_type') void resync();
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
      if (exchangedFor.current === did && me) return;
      if (exchangedFor.current && exchangedFor.current !== did) setMe(null);
      try {
        const existing = await fetchApiMe().catch(() => null);
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
  }, [ready, authenticated, user, me, embeddedWallet?.address, exchange]);

  useEffect(() => {
    if (!authenticated || !me || embeddedWallet?.address || walletProvisionedFor.current === me.did) return;
    walletProvisionedFor.current = me.did;
    void createSolanaWallet()
      .catch(() => undefined)
      .then(exchange);
  }, [authenticated, me, embeddedWallet?.address, createSolanaWallet, exchange]);

  // Privy holds an email or X our session is missing (typical after linking in
  // another tab): pull it in once per user so the profile step shows Ready
  // instead of offering a link that Privy rejects as a duplicate.
  useEffect(() => {
    if (!ready || !authenticated || !me || exchanging) return;
    const missing = (Boolean(user?.email?.address) && !me.email) || (Boolean(user?.twitter) && !me.hasX);
    const key = `${me.id}:${user?.email?.address ? 'e' : ''}${user?.twitter ? 'x' : ''}`;
    if (!missing || syncedAccountsFor.current === key) return;
    syncedAccountsFor.current = key;
    void resync();
  }, [ready, authenticated, me, user, exchanging, resync]);

  const privyEmail = user?.email?.address ?? undefined;
  const walletDelegated = Boolean(embeddedWallet?.delegated);
  const mfaEnabled = (user?.mfaMethods?.length ?? 0) > 0;
  const walletAddress = embeddedWallet?.address ?? me?.walletAddress;
  // Privy is the source of truth for what is linked; the session row can lag.
  const email = me?.email ?? privyEmail;
  const hasX = Boolean(me?.hasX || user?.twitter);
  const onboardingComplete = Boolean(hasX && email && walletAddress && walletDelegated);

  const value: AuthSession = {
    ready: ready && !exchanging,
    privyAuthenticated: authenticated,
    authenticated: Boolean(authenticated && hasX),
    userId: me?.id,
    isReviewer: me?.isReviewer ?? false,
    handle: me?.handle ?? user?.twitter?.username ?? undefined,
    name: me?.name ?? user?.twitter?.name ?? undefined,
    avatar: me?.avatar ?? user?.twitter?.profilePictureUrl ?? undefined,
    email,
    walletAddress,
    walletDelegated,
    mfaEnabled,
    hasX,
    onboardingComplete,
    accountType: me?.onboarding?.accountType,
    loggingIn: exchanging,
    error,
    login: (options?: { method?: 'twitter' | 'google' | 'email' } | React.MouseEvent<any>) => {
      setError(undefined);
      const isEvent = Boolean(options && ('nativeEvent' in options || 'preventDefault' in options));
      const method = !isEvent && options && 'method' in options ? options.method : undefined;
      if (authenticated) {
        if (!user?.twitter && (method === 'twitter' || !hasX)) {
          privyLinkTwitter();
          return;
        }
        exchangedFor.current = null;
        void exchange();
      } else {
        if (method === 'twitter') {
          privyLogin({ loginMethods: ['twitter'] });
        } else {
          privyLogin();
        }
      }
    },
    linkEmail: () => {
      setError(undefined);
      // Already linked in Privy: another link rejects with "User already has an
      // account of type email linked." Pull the existing one into our session.
      if (privyEmail) { void resync(); return; }
      privyLinkEmail();
    },
    linkX: () => {
      setError(undefined);
      if (user?.twitter) { void resync(); return; }
      privyLinkTwitter();
    },
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
    setupMfa: showMfaEnrollmentModal,
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
      {authenticated && me && onboardingComplete && !me.onboarding && (
        <RoleOnboardingModal onSaved={(onboarding) => setMe({ ...me, onboarding })} onLogout={() => void value.logout()} />
      )}
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

const SOCIAL_LABELS: Record<SocialPlatform, string> = { x: 'X', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
const inputClass = 'w-full rounded-lg border border-[#e7e5e0] px-3 py-2 text-sm text-[#020817] outline-none focus:border-[#4166fb]';

function RoleOnboardingModal({ onSaved, onLogout }: { onSaved: (onboarding: Onboarding) => void; onLogout: () => void }) {
  const [role, setRole] = useState<AccountType | null>(null);
  const [socials, setSocials] = useState<Partial<Record<SocialPlatform, string>>>({});
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState<BrandCategory | ''>('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const submit = async () => {
    if (!role) return;
    setError(undefined);
    setSaving(true);
    try {
      const payload: Onboarding = role === 'creator'
        ? { accountType: 'creator', creator: { socials } }
        : { accountType: 'sponsor', sponsor: { brandName, category: category as BrandCategory, website } };
      onSaved(await saveOnboarding(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="role-title">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#4166fb]">Welcome to Adspaces</p>
        <h2 id="role-title" className="mt-2 text-2xl font-semibold text-[#020817]">How will you use Adspaces?</h2>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {([['creator', 'Creator', 'I sell ad space'], ['sponsor', 'Sponsor / brand', 'I buy ad space']] as const).map(([value, title, hint]) => (
            <button
              key={value}
              type="button"
              onClick={() => setRole(value)}
              aria-pressed={role === value}
              className={`rounded-xl border p-4 text-left ${role === value ? 'border-[#4166fb] bg-[#4166fb]/5' : 'border-[#e7e5e0]'}`}
            >
              <span className="block text-sm font-semibold text-[#020817]">{title}</span>
              <span className="mt-1 block text-xs text-[#526079]">{hint}</span>
            </button>
          ))}
        </div>

        {role === 'creator' && (
          <div className="mt-5 space-y-3">
            <p className="text-sm text-[#526079]">Where do people see you? Add at least one.</p>
            {SOCIAL_PLATFORMS.map((platform) => (
              <label key={platform} className="block text-sm font-medium text-[#020817]">
                {SOCIAL_LABELS[platform]}
                <input className={`${inputClass} mt-1`} placeholder="@handle or profile link" maxLength={100} value={socials[platform] ?? ''} onChange={(e) => setSocials({ ...socials, [platform]: e.target.value })} />
              </label>
            ))}
          </div>
        )}

        {role === 'sponsor' && (
          <div className="mt-5 space-y-3">
            <label className="block text-sm font-medium text-[#020817]">
              Brand name
              <input className={`${inputClass} mt-1`} maxLength={80} value={brandName} onChange={(e) => setBrandName(e.target.value)} />
            </label>
            <label className="block text-sm font-medium text-[#020817]">
              What kind of brand?
              <select className={`${inputClass} mt-1`} value={category} onChange={(e) => setCategory(e.target.value as BrandCategory)}>
                <option value="" disabled>Select a category</option>
                {BRAND_CATEGORIES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
              </select>
            </label>
            <label className="block text-sm font-medium text-[#020817]">
              Website <span className="font-normal text-[#526079]">(optional)</span>
              <input className={`${inputClass} mt-1`} type="url" placeholder="https://" maxLength={200} value={website} onChange={(e) => setWebsite(e.target.value)} />
            </label>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
        <button type="button" disabled={!role || saving} onClick={() => void submit()} className="mt-6 w-full rounded-lg bg-[#020817] px-3 py-2.5 text-sm font-medium text-white disabled:opacity-40">
          {saving ? 'Saving…' : 'Continue'}
        </button>
        <button type="button" onClick={onLogout} className="mt-4 text-sm text-[#526079] underline underline-offset-4">Log out</button>
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
