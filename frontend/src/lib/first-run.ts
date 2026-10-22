// Sends someone into account setup right after their first sign-in, instead of leaving them on the page
// they signed in from with no next step. Both flags live in sessionStorage because Privy's OAuth logins
// can reload the page, which would lose component state.

// A visitor who signed in to buy a spot: checkout reopens after sign-in and verifies email itself, so
// setup must not interrupt it. Written by the listing page.
export const PENDING_CHECKOUT = "adspaces:pending-checkout";
const SIGN_IN_STARTED = "adspaces:sign-in-started";
const FRESH_MS = 15 * 60_000;

// Called when the visitor presses sign in.
export function markSignInStarted() {
  try {
    sessionStorage.setItem(SIGN_IN_STARTED, String(Date.now()));
  } catch {
    // Storage blocked (private mode): they reach setup from any page that needs it.
  }
}

// True once, for a sign-in started in this tab in the last 15 minutes; the flag is cleared on read.
export function takeFreshSignIn(): boolean {
  try {
    const started = Number(sessionStorage.getItem(SIGN_IN_STARTED));
    sessionStorage.removeItem(SIGN_IN_STARTED);
    return started > 0 && Date.now() - started < FRESH_MS;
  } catch {
    return false;
  }
}

export function hasPendingCheckout(): boolean {
  try {
    return Boolean(sessionStorage.getItem(PENDING_CHECKOUT));
  } catch {
    return false;
  }
}
