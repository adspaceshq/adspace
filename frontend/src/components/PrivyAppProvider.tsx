'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { PRIVY_APP_ID } from '@/lib/privy';

export default function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) {
    // Don't crash the demo if env is missing — render children unauthenticated.
    if (typeof window !== 'undefined') {
      console.warn(
        'NEXT_PUBLIC_PRIVY_APP_ID is missing. Add it to frontend/.env.local to enable X login.',
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // X-only. Wallet login ships later with real payments.
        // Dashboard must have X (Twitter) enabled as a login method.
        loginMethods: ['twitter'],
        appearance: {
          theme: 'light',
          accentColor: '#4166fb',
          landingHeader: 'Log in with X',
          loginMessage: 'Your X handle is your identity on Adspaces.',
          showWalletLoginFirst: false,
        },
        embeddedWallets: {
          ethereum: { createOnLogin: 'off' },
          solana: { createOnLogin: 'off' },
        },
        externalWallets: {
          disableAllExternalWallets: true,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
