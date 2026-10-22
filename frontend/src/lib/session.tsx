"use client";

import dynamic from "next/dynamic";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Session } from "@/lib/api/types";
import { PRIVY_APP_ID } from "@/lib/privy";
import { markSignInStarted } from "@/lib/first-run";

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

// A browser wallet (Phantom and the like) connected through Privy. Only the ops panel uses it, for the
// pause guardian; it never takes part in login.
export interface ExternalWalletAccess {
  // Addresses of the Solana wallets Privy currently has connected (the embedded wallet included).
  addresses: string[];
  // Opens Privy's wallet picker. Resolves the connected Solana address, or null if the user backs out.
  connect: (description: string) => Promise<string | null>;
  // Sign only (never send) a server-prepared transaction with that wallet; base64 in, base64 out.
  sign: (address: string, base64: string) => Promise<string>;
  disconnect: (address: string) => Promise<void>;
}

export interface SessionState {
  ready: boolean;
  session: Session | null;
  wallet: WalletAccess;
  external: ExternalWalletAccess;
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
  // Loads Privy now. Signed-in areas call it on mount; public pages load it only when needed.
  requestAuth: () => void;
}

const notLoaded = async () => {
  throw new Error("sign in first");
};

export const noWallet: WalletAccess = {
  delegated: false,
  mfaEnabled: false,
  enableGasless: async () => {},
  reconnectGasless: async () => {},
  setupMfa: () => {},
  signTransaction: notLoaded,
};

export const noExternal: ExternalWalletAccess = {
  addresses: [],
  connect: async () => null,
  sign: notLoaded,
  disconnect: async () => {},
};

const guest: SessionState = {
  ready: true,
  session: null,
  wallet: noWallet,
  external: noExternal,
  signIn: () => {},
  signOut: async () => {},
  refresh: async () => {},
  linkEmail: async () => false,
  updateEmail: () => {},
  loadError: false,
  requestAuth: () => {},
};

const SessionContext = createContext<SessionState>(guest);

export function useSession(): SessionState {
  return useContext(SessionContext);
}

// Asks for Privy as soon as a signed-in area mounts, so it doesn't wait for a hint or a click.
export function useRequireAuth() {
  const { requestAuth } = useSession();
  useEffect(() => requestAuth(), [requestAuth]);
}

// What the Privy bridge reports up; the provider adds requestAuth.
export type BridgedSession = Omit<SessionState, "requestAuth">;

export interface PrivyBridgeProps {
  onChange: (state: BridgedSession) => void;
  // Set when someone pressed sign in before Privy had loaded; the bridge opens login once ready.
  loginRequested: boolean;
  onLoginHandled: () => void;
}

// Privy (and the Solana wallet stack it brings) is large, so it is not part of any page's first load.
// It is loaded after hydration only when it can matter: a signed-in area mounts, someone presses
// sign in, or this browser holds a previous Privy session (so the top bar can show the account).
// Rendered beside the page, not around it, so loading it never remounts what's on screen.
const PrivyBridge = dynamic<PrivyBridgeProps>(() => import("@/lib/privy-bridge"), { ssr: false });

// Privy keeps its tokens in localStorage under "privy:" keys; any of them means a session may exist.
function hasPrivyHint(): boolean {
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      if (window.localStorage.key(index)?.startsWith("privy:")) return true;
    }
  } catch {
    // Storage blocked (private mode, policies): Privy can't have a stored session either.
  }
  return false;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <SessionContext.Provider value={guest}>{children}</SessionContext.Provider>;
  return <LazyPrivySession>{children}</LazyPrivySession>;
}

const noSubscription = () => () => {};
const hintSnapshot = () => (hasPrivyHint() ? "signed-in" : "guest");
// The server can't see localStorage; until hydration the session counts as unknown (not ready).
const serverHintSnapshot = () => "unknown";

// Whether this browser was signed in last time (Privy's stored token), known before Privy loads. Lets a
// layout show the signed-in frame from the first paint instead of jumping once the session arrives.
export function useSignedInHint(): boolean {
  return useSyncExternalStore(noSubscription, hintSnapshot, serverHintSnapshot) === "signed-in";
}

function LazyPrivySession({ children }: { children: React.ReactNode }) {
  const hint = useSyncExternalStore(noSubscription, hintSnapshot, serverHintSnapshot);
  const checked = hint !== "unknown";
  const [requested, setRequested] = useState(false);
  const load = requested || hint === "signed-in";
  const [loginRequested, setLoginRequested] = useState(false);
  const [bridged, setBridged] = useState<BridgedSession | null>(null);

  const requestAuth = useCallback(() => setRequested(true), []);
  const signIn = useCallback(() => {
    markSignInStarted();
    setLoginRequested(true);
    setRequested(true);
  }, []);
  const onLoginHandled = useCallback(() => setLoginRequested(false), []);

  const value = useMemo<SessionState>(() => {
    // Privy already loaded: still note the sign-in, so a first-time user is taken to setup afterwards.
    if (bridged)
      return {
        ...bridged,
        signIn: () => {
          markSignInStarted();
          bridged.signIn();
        },
        requestAuth,
      };
    // Loading Privy: not ready yet. Not loading: a guest, with sign in loading Privy on demand.
    return { ...guest, ready: checked && !load, signIn, requestAuth };
  }, [bridged, checked, load, signIn, requestAuth]);

  return (
    <SessionContext.Provider value={value}>
      {children}
      {load && <PrivyBridge onChange={setBridged} loginRequested={loginRequested} onLoginHandled={onLoginHandled} />}
    </SessionContext.Provider>
  );
}
