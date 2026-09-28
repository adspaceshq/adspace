'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID } from '@/lib/privy';

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
        loginMethods: ['google', 'twitter', 'email', 'wallet'],
        appearance: {
          theme: 'light',
          accentColor: '#4166fb',
          landingHeader: 'Log in to Adspaces',
          loginMessage: 'Continue with Google, X, email, or your wallet.',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'all-users' },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
