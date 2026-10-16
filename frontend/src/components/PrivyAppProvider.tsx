'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { PRIVY_APP_ID } from '@/lib/privy';

// Solana wallet connectors exist only for the admin ops panel, where the pause guardian connects its
// own wallet (e.g. Phantom) to sign guardian_pause. They don't touch login: the login modal lists
// wallets only when loginMethods includes 'wallet', which it doesn't. No auto-connect, so a wallet is
// connected only when an admin presses "connect guardian wallet".
const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: false });

// The browser never talks to our paid RPC (audit F-14). The server builds, submits and confirms every
// transaction; the browser only signs headlessly (showWalletUIs: false), which makes no RPC calls.
// Privy still wants an endpoint per chain for its optional wallet screens, so it gets the public cluster
// ones. The paid key stays server-side in SOLANA_RPC_URL; never put an RPC URL in a NEXT_PUBLIC_ variable.
const solanaRpcs = {
  'solana:devnet': {
    rpc: createSolanaRpc('https://api.devnet.solana.com'),
    rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.devnet.solana.com'),
    blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
  },
  'solana:mainnet': {
    rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
    rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com'),
    blockExplorerUrl: 'https://explorer.solana.com',
  },
};

export default function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    // Don't crash the demo if env is missing — render children unauthenticated.
    if (typeof window !== 'undefined') {
      console.warn(
        'NEXT_PUBLIC_PRIVY_APP_ID is missing. Add it to frontend/.env.local to enable login.',
      );
    }
    return <>{children}</>;
  }
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['google', 'twitter', 'email'],
        appearance: {
          theme: 'light',
          accentColor: '#4166fb',
          landingHeader: 'Log in to Adspaces',
          loginMessage: 'Continue with Google, X, or email.',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'all-users' },
        },
        solana: { rpcs: solanaRpcs },
        externalWallets: { solana: { connectors: solanaConnectors } },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
