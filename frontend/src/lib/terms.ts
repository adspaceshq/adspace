// Mirrors TERMS_VERSION in backend/src/types.ts (the source of truth; lib/terms.test.ts checks they match).
// Sent with every claim, bid and onboarding; the backend records it and refuses any other version.
export const TERMS_VERSION = "v1";
