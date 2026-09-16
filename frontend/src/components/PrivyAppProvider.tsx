'use client';

import { PrivyProvider } from '@privy-io/react-auth';

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? '';

export default function PrivyAppProvider({ children }: { children: React.ReactNode }) {
  if (!appId) {
    // Don't crash the demo if env is missing — show a one-time warning in console
    // and render children unauthenticated.
    if (typeof window !== 'undefined') {
      console.warn(
        'NEXT_PUBLIC_PRIVY_APP_ID is missing. Add it to frontend/.env.local to enable login.'
      );
    }
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        // X-only for now — wallet comes later.
        // Dashboard must have X (Twitter) enabled as a login method.
        loginMethods: ['twitter'],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
