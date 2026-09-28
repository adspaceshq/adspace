'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import { PRIVY_APP_ID } from '@/lib/privy';

const rpcUrl = process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
const websocketUrl = process.env.NEXT_PUBLIC_SOLANA_WEBSOCKET_URL
  ?? rpcUrl?.replace(/^http/, 'ws');

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
  if (!rpcUrl || !websocketUrl) throw new Error('Solana RPC and websocket configuration are required');

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
        solana: {
          rpcs: {
            'solana:devnet': {
              rpc: createSolanaRpc(rpcUrl),
              rpcSubscriptions: createSolanaRpcSubscriptions(websocketUrl),
              blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
            },
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
