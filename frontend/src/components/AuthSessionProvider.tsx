'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLinkAccount, useMfaEnrollment, usePrivy, useSigners, useUser } from '@privy-io/react-auth';
import type { PrivyErrorCode } from '@privy-io/react-auth';
import { useCreateWallet as useCreateSolanaWallet } from '@privy-io/react-auth/solana';
import { ApiError, createApiSession, fetchApiMe, logoutApiSession, saveOnboarding } from '@/lib/auth-api';
import { PRIVY_ENABLED } from '@/lib/privy';
import { BRAND_CATEGORIES, SOCIAL_PLATFORMS } from '@/lib/types';
import type { AccountType, BrandCategory, Onboarding, SessionUser, SocialPlatform } from '@/lib/types';
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Globe,
  Loader2,
  LogOut,
  Sparkles,
} from 'lucide-react';

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
        <RoleOnboardingModal auth={value} onSaved={(onboarding) => setMe({ ...me, onboarding })} onLogout={() => void value.logout()} />
      )}
    </AuthSessionContext.Provider>
  );
}

function ProfileCompletionModal({ auth }: { auth: AuthSession }) {
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-[#020817]/65 backdrop-blur-md p-4" role="dialog" aria-modal="true" aria-labelledby="complete-profile-title">
      <div className="w-full max-w-md rounded-[28px] border border-[#e7e5e0] bg-white p-6 sm:p-7 shadow-[0_24px_60px_rgba(2,8,23,0.22)]">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#4166fb]">
          One last step
        </div>
        <h2 id="complete-profile-title" className="mt-3 text-2xl font-bold tracking-tight text-[#020817]">Complete your profile</h2>
        <p className="mt-2 text-sm leading-6 text-[#526079]">Verify your contact details and prepare your embedded Solana wallet for Adspaces transactions.</p>
        <div className="mt-6 space-y-3">
          <ProfileRequirement complete={auth.hasX} label="X account" actionLabel="Connect X" onAction={auth.linkX} />
          <ProfileRequirement complete={Boolean(auth.email)} label="Verified email" actionLabel="Add email" onAction={auth.linkEmail} />
          <ProfileRequirement complete={Boolean(auth.walletAddress)} label="Privy Solana wallet" pendingLabel="Creating wallet…" />
          <ProfileRequirement complete={auth.walletDelegated} label="Gasless transactions" actionLabel="Enable" onAction={() => void auth.delegateWallet()} />
        </div>
        {auth.error && <p className="mt-4 text-sm text-red-600">{auth.error}</p>}
        <button type="button" onClick={() => void auth.logout()} className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-[#526079] hover:text-[#020817] transition-colors">
          <LogOut className="h-3.5 w-3.5" />
          <span>Log out</span>
        </button>
      </div>
    </div>
  );
}

const BRAND_CATEGORY_CONFIG: Record<BrandCategory, { label: string; hint: string }> = {
  crypto: { label: 'Crypto & Web3', hint: 'Protocols, dApps, wallets' },
  saas: { label: 'SaaS & DevTools', hint: 'Cloud apps, dev tools, APIs' },
  fintech: { label: 'FinTech', hint: 'Payments, investing, banking' },
  gaming: { label: 'Gaming', hint: 'Games, studios, metaverses' },
  consumer: { label: 'Consumer & Hardware', hint: 'Products, devices, gadgets' },
  media: { label: 'Media & Entertainment', hint: 'Newsletters, podcasts, design' },
  fitness: { label: 'Health & Fitness', hint: 'Sports, wellness, health' },
  other: { label: 'Other', hint: 'Agencies & general services' },
};

function SocialIcon({ platform }: { platform: SocialPlatform }) {
  switch (platform) {
    case 'x':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current shrink-0" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      );
    case 'instagram':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-2 shrink-0" aria-hidden="true">
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
      );
    case 'youtube':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current shrink-0" aria-hidden="true">
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
        </svg>
      );
    case 'tiktok':
      return (
        <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current shrink-0" aria-hidden="true">
          <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.47 6.27 6.27 0 0 0 1.93-4.52V8.78a8.28 8.28 0 0 0 4.84 1.55V6.89a4.85 4.85 0 0 1-1-.2z"/>
        </svg>
      );
  }
}

const SOCIAL_LABELS: Record<SocialPlatform, string> = { x: 'X / Twitter', instagram: 'Instagram', youtube: 'YouTube', tiktok: 'TikTok' };
const SOCIAL_PLACEHOLDERS: Record<SocialPlatform, string> = {
  x: '@username or x.com/handle',
  instagram: '@handle or instagram.com/handle',
  youtube: '@channel or youtube.com/@handle',
  tiktok: '@handle or tiktok.com/@handle',
};

function RoleOnboardingModal({
  auth,
  onSaved,
  onLogout,
}: {
  auth: AuthSession;
  onSaved: (onboarding: Onboarding) => void;
  onLogout: () => void;
}) {
  const [step, setStep] = useState<'role' | 'details'>('role');
  const [role, setRole] = useState<AccountType | null>(null);
  const [socials, setSocials] = useState<Partial<Record<SocialPlatform, string>>>(() => {
    if (auth.handle) {
      const clean = auth.handle.trim();
      return { x: clean.startsWith('@') ? clean : `@${clean}` };
    }
    return {};
  });
  const [brandName, setBrandName] = useState('');
  const [category, setCategory] = useState<BrandCategory | ''>('');
  const [website, setWebsite] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  // Determine if required fields are satisfied
  const hasAtLeastOneSocial = Object.values(socials).some((val) => Boolean(val && val.trim().length > 0));
  const isSponsorValid = Boolean(brandName.trim().length > 0 && category);
  const canSubmit = role === 'creator' ? hasAtLeastOneSocial : isSponsorValid;

  const submit = async () => {
    if (!role || !canSubmit) return;
    setError(undefined);
    setSaving(true);
    try {
      const payload: Onboarding = role === 'creator'
        ? { accountType: 'creator', creator: { socials } }
        : { accountType: 'sponsor', sponsor: { brandName: brandName.trim(), category: category as BrandCategory, ...(website.trim() ? { website: website.trim() } : {}) } };
      onSaved(await saveOnboarding(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#020817]/65 backdrop-blur-md p-4 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-onboarding-title"
    >
      <div className="relative w-full max-w-[560px] overflow-hidden rounded-[30px] border border-[#e7e5e0] bg-white p-6 sm:p-8 shadow-[0_25px_70px_rgba(2,8,23,0.25)] transition-all">
        {/* Step 1: Who are you? (Role Selection) */}
        {step === 'role' && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#4166fb]/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-[#4166fb]">
                ✨ Welcome to Adspaces
              </span>
              <span className="text-xs font-medium text-[#64748b]">Step 1 of 2</span>
            </div>

            <h2 id="role-onboarding-title" className="mt-3 text-[26px] sm:text-[28px] font-bold tracking-tight text-[#020817] leading-tight">
              Who are you?
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#526079]">
              Choose how you will be participating in Adspaces. We customize your dashboard, tools, and discovery based on your role.
            </p>

            {/* Role Options */}
            <div className="mt-6 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              {/* Creator Card */}
              <button
                type="button"
                onClick={() => setRole('creator')}
                className={`group relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] ${
                  role === 'creator'
                    ? 'border-[#4166fb] bg-[#4166fb]/[0.04] ring-2 ring-[#4166fb]/25 shadow-sm'
                    : 'border-[#e7e5e0] bg-white hover:border-[#cbd5e1] hover:bg-[#fafafa]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-[#4166fb] ring-1 ring-[#4166fb]/20 group-hover:scale-105 transition-transform">
                      <Sparkles className="h-5 w-5" />
                    </div>
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all ${
                        role === 'creator'
                          ? 'border-[#4166fb] bg-[#4166fb] text-white'
                          : 'border-[#cbd5e1] bg-white'
                      }`}
                    >
                      {role === 'creator' && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-[#020817]">Creator</h3>
                  <p className="mt-0.5 text-xs font-medium text-[#4166fb]">I have ad space to sell</p>
                  <p className="mt-2 text-xs leading-relaxed text-[#64748b]">
                    Monetize your laptop lid, dev project, newsletter, podcast, or hardware surfaces.
                  </p>
                </div>

                <div className="mt-4 border-t border-[#f1f0ec] pt-3">
                  <span className="inline-flex items-center text-[11px] font-medium text-[#526079]">
                    ⚡ Instant USDC wallet payouts
                  </span>
                </div>
              </button>

              {/* Sponsor / Brand Card */}
              <button
                type="button"
                onClick={() => setRole('sponsor')}
                className={`group relative flex flex-col justify-between rounded-2xl border p-5 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4166fb] ${
                  role === 'sponsor'
                    ? 'border-[#4166fb] bg-[#4166fb]/[0.04] ring-2 ring-[#4166fb]/25 shadow-sm'
                    : 'border-[#e7e5e0] bg-white hover:border-[#cbd5e1] hover:bg-[#fafafa]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 ring-1 ring-amber-500/20 group-hover:scale-105 transition-transform">
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded-full border transition-all ${
                        role === 'sponsor'
                          ? 'border-[#4166fb] bg-[#4166fb] text-white'
                          : 'border-[#cbd5e1] bg-white'
                      }`}
                    >
                      {role === 'sponsor' && <Check className="h-3 w-3 stroke-[3]" />}
                    </div>
                  </div>

                  <h3 className="mt-4 text-base font-semibold text-[#020817]">Sponsor / Brand</h3>
                  <p className="mt-0.5 text-xs font-medium text-amber-600">I want to buy ad space</p>
                  <p className="mt-2 text-xs leading-relaxed text-[#64748b]">
                    Place your brand on top creators&apos; surfaces, tap into tech audiences, and track spots.
                  </p>
                </div>

                <div className="mt-4 border-t border-[#f1f0ec] pt-3">
                  <span className="inline-flex items-center text-[11px] font-medium text-[#526079]">
                    🛡️ Escrow-protected campaigns
                  </span>
                </div>
              </button>
            </div>

            {/* Step 1 Actions */}
            <div className="mt-7">
              <button
                type="button"
                disabled={!role}
                onClick={() => setStep('details')}
                className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-[#020817] px-4 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#1e293b] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#020817]"
              >
                <span>Continue</span>
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </button>

              <div className="mt-4 flex items-center justify-between text-xs text-[#64748b]">
                <span>You can adjust this anytime in settings.</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-1.5 font-medium text-[#526079] hover:text-[#020817] underline underline-offset-4 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Role Details */}
        {step === 'details' && (
          <div>
            {/* Top Navigation Bar */}
            <div className="flex items-center justify-between border-b border-[#f1f0ec] pb-3 mb-5">
              <button
                type="button"
                onClick={() => {
                  setError(undefined);
                  setStep('role');
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#526079] hover:text-[#020817] transition-colors"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>Back to role choice</span>
              </button>
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-[#020817]">
                {role === 'creator' ? 'Role: Creator' : 'Role: Sponsor'}
              </span>
            </div>

            {/* Creator Step 2 Form */}
            {role === 'creator' && (
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#020817]">
                  Where do people find you?
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-[#526079] leading-relaxed">
                  Add at least one social handle or profile link so sponsors can verify your audience and work.
                </p>

                <div className="mt-5 space-y-3">
                  {SOCIAL_PLATFORMS.map((platform) => {
                    const hasVal = Boolean(socials[platform]?.trim());
                    return (
                      <div key={platform} className="relative">
                        <label className="mb-1 block text-xs font-semibold text-[#020817]">
                          {SOCIAL_LABELS[platform]}
                        </label>
                        <div className="relative flex items-center">
                          <div className="pointer-events-none absolute left-3 flex items-center text-[#64748b]">
                            <SocialIcon platform={platform} />
                          </div>
                          <input
                            className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafafa] py-2.5 pl-9 pr-3 text-sm text-[#020817] placeholder-[#94a3b8] outline-none transition focus:border-[#4166fb] focus:bg-white focus:ring-2 focus:ring-[#4166fb]/15"
                            placeholder={SOCIAL_PLACEHOLDERS[platform]}
                            maxLength={100}
                            value={socials[platform] ?? ''}
                            onChange={(e) => setSocials({ ...socials, [platform]: e.target.value })}
                          />
                          {hasVal && (
                            <div className="pointer-events-none absolute right-3 flex items-center text-emerald-600">
                              <CheckCircle2 className="h-4 w-4" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-3 flex items-center justify-between text-xs">
                  <span className={`font-medium ${hasAtLeastOneSocial ? 'text-emerald-700' : 'text-[#64748b]'}`}>
                    {hasAtLeastOneSocial ? '✓ At least one social link provided' : '• Please fill in at least one profile'}
                  </span>
                </div>
              </div>
            )}

            {/* Sponsor Step 2 Form */}
            {role === 'sponsor' && (
              <div>
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#020817]">
                  Tell us about your brand
                </h2>
                <p className="mt-1.5 text-xs sm:text-sm text-[#526079] leading-relaxed">
                  Creators will see these details when you make offers or book ad spaces.
                </p>

                <div className="mt-5 space-y-3.5">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#020817]">
                      Brand or Company Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafafa] px-3 py-2.5 text-sm text-[#020817] placeholder-[#94a3b8] outline-none transition focus:border-[#4166fb] focus:bg-white focus:ring-2 focus:ring-[#4166fb]/15"
                      placeholder="e.g. Solana FM, Acme Labs, Superfluid"
                      maxLength={80}
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                    />
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#020817]">
                      Industry Category <span className="text-red-500">*</span>
                    </label>
                    <select
                      className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafafa] px-3 py-2.5 text-sm text-[#020817] outline-none transition focus:border-[#4166fb] focus:bg-white focus:ring-2 focus:ring-[#4166fb]/15"
                      value={category}
                      onChange={(e) => setCategory(e.target.value as BrandCategory)}
                    >
                      <option value="" disabled>Select your brand category</option>
                      {BRAND_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {BRAND_CATEGORY_CONFIG[c]?.label ?? c}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="mb-1 block text-xs font-semibold text-[#020817]">
                      Official Website <span className="font-normal text-[#64748b]">(optional)</span>
                    </label>
                    <div className="relative flex items-center">
                      <div className="pointer-events-none absolute left-3 flex items-center text-[#64748b]">
                        <Globe className="h-4 w-4" />
                      </div>
                      <input
                        className="w-full rounded-xl border border-[#e7e5e0] bg-[#fafafa] py-2.5 pl-9 pr-3 text-sm text-[#020817] placeholder-[#94a3b8] outline-none transition focus:border-[#4166fb] focus:bg-white focus:ring-2 focus:ring-[#4166fb]/15"
                        type="url"
                        placeholder="https://yourbrand.com"
                        maxLength={200}
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50/80 p-3 text-xs text-red-700">
                {error}
              </div>
            )}

            {/* Step 2 Actions */}
            <div className="mt-6 pt-2">
              <button
                type="button"
                disabled={!canSubmit || saving}
                onClick={() => void submit()}
                className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-[#020817] px-4 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:bg-[#1e293b] active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[#020817]"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Setting up your account…</span>
                  </>
                ) : (
                  <>
                    <span>Complete setup</span>
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <div className="mt-4 flex items-center justify-between text-xs text-[#64748b]">
                <span>You can edit these details anytime in profile settings.</span>
                <button
                  type="button"
                  onClick={onLogout}
                  className="inline-flex items-center gap-1.5 font-medium text-[#526079] hover:text-[#020817] underline underline-offset-4 transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span>Log out</span>
                </button>
              </div>
            </div>
          </div>
        )}
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
