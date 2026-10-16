// Listing schedule rules shared by the sell wizard and the review screen. They mirror the backend
// (listing-lifecycle.ts) and the program's create_listing bounds.

const DAY = 24 * 60 * 60 * 1000;

// The program refuses delivery dates further out than this.
export const MAX_DELIVERY_DAYS = 365;
// Product rule: any reviewer can approve delivery up to this many days out; beyond it only an admin can.
export const ADMIN_APPROVAL_AFTER_DAYS = 90;
// Largest auction bid step, in USDC base units (1,000,000 USDC); mirrors the program's MAX_BID_INCREMENT.
export const MAX_BID_INCREMENT = 1_000_000_000_000n;

export function needsAdminApproval(deliveryDueAt: number | string | Date, now = Date.now(), afterDays = ADMIN_APPROVAL_AFTER_DAYS): boolean {
  const delivery = new Date(deliveryDueAt).getTime();
  return !Number.isNaN(delivery) && delivery > now + afterDays * DAY;
}

export function beyondHorizon(deliveryDueAt: number | string | Date, now = Date.now()): boolean {
  const delivery = new Date(deliveryDueAt).getTime();
  return !Number.isNaN(delivery) && delivery > now + MAX_DELIVERY_DAYS * DAY;
}

export const adminApprovalMessage = (afterDays = ADMIN_APPROVAL_AFTER_DAYS) => `listings longer than ${afterDays} days need an admin to approve`;

// Proof is accepted on-chain only from artwork close (never before it, even once claims closed)
// until the delivery deadline.
export type ProofWindow = "not_yet" | "open" | "closed";
export function proofWindow(listing: { artworkDueAt: string; deliveryDueAt: string }, now = Date.now()): ProofWindow {
  if (now < new Date(listing.artworkDueAt).getTime()) return "not_yet";
  return now < new Date(listing.deliveryDueAt).getTime() ? "open" : "closed";
}
