/** Public Privy App ID. Safe to expose; required for X login. */
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim() ?? '';

export const PRIVY_ENABLED = PRIVY_APP_ID.length > 0;
