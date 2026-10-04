import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";
import type {
  ApiCreateListingRequest,
  ReviewPolicyRequest,
  ApiListing,
  ApiListingSummary,
  Onboarding,
  ApiSpot,
  DisputeItem,
  PayoutItem,
  PublicProfile,
  SessionUser,
  SellerDashboard,
  SponsorDashboard,
  TermsDoc,
  UpdateProfileRequest,
  WalletWithdrawal,
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
let csrfToken: string | null = null;

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function parseError(res: Response): Promise<{ message: string; code?: string }> {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  const body = err as { error?: string; code?: string };
  return { message: body.error ?? `request failed: ${res.status}`, code: body.code };
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const parsed = await parseError(res);
    throw new ApiError(parsed.message, res.status, parsed.code);
  }
  return res.json() as Promise<T>;
}

/** Owner POST without a body: session cookie + Privy Bearer + CSRF. */
export async function apiPostEmpty<T>(path: string): Promise<T> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  return request<T>(path, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
  });
}

/** Owner DELETE: session cookie + Privy Bearer + CSRF. */
export async function apiDelete<T>(path: string): Promise<T> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  return request<T>(path, {
    method: "DELETE",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
  });
}
/** Authenticated POST: session cookie + Privy Bearer so the API can verify X. */
export async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  return request<T>(path, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  return request<T>(path);
}

/** Authenticated PATCH: session cookie + Privy Bearer + CSRF. */
export async function apiPatch<T>(path: string, body: unknown = {}): Promise<T> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  return request<T>(path, {
    method: "PATCH",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(body),
  });
}

export function fetchProfile(handle: string): Promise<PublicProfile> {
  const clean = handle.trim().replace(/^@+/, "");
  return apiGet<PublicProfile>(`/api/users/${encodeURIComponent(clean)}`);
}

export function updateMyProfile(patch: UpdateProfileRequest): Promise<PublicProfile> {
  return apiPatch<PublicProfile>("/api/users/me", patch);
}

export async function saveOnboarding(input: Onboarding): Promise<Onboarding> {
  let token: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  return request<Onboarding>("/api/users/me/onboarding", {
    method: "PUT",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
    },
    body: JSON.stringify(input),
  });
}

export function fetchWalletWithdrawals(): Promise<WalletWithdrawal[]> {
  return apiGet<WalletWithdrawal[]>("/api/wallet/withdrawals");
}

export function createWalletWithdrawal(destination: string, amount: number): Promise<WalletWithdrawal> {
  return apiPost<WalletWithdrawal>("/api/wallet/withdrawals", { destination, amount });
}

export function executeWalletWithdrawal(id: string): Promise<WalletWithdrawal> {
  return apiPostEmpty<WalletWithdrawal>(`/api/wallet/withdrawals/${encodeURIComponent(id)}/execute`);
}

export function confirmWalletWithdrawal(id: string, signature: string): Promise<WalletWithdrawal> {
  return apiPost<WalletWithdrawal>(`/api/wallet/withdrawals/${encodeURIComponent(id)}/confirm`, { signature });
}

export function failWalletWithdrawal(id: string): Promise<WalletWithdrawal> {
  return apiPostEmpty<WalletWithdrawal>(`/api/wallet/withdrawals/${encodeURIComponent(id)}/fail`);
}

export function fetchListingSummaries(): Promise<ApiListingSummary[]> {
  return apiGet<ApiListingSummary[]>("/api/listings");
}

export function fetchListing(slug: string): Promise<ApiListing> {
  return apiGet<ApiListing>(`/api/listings/${encodeURIComponent(slug)}`);
}

export function createApiListing(req: ApiCreateListingRequest): Promise<ApiListing> {
  return apiPost<ApiListing>("/api/listings", req);
}

export function closeApiListing(slug: string): Promise<ApiListing> {
  return apiPostEmpty<ApiListing>(`/api/listings/${encodeURIComponent(slug)}/close`);
}

export function reopenApiListing(slug: string): Promise<ApiListing> {
  return apiPostEmpty<ApiListing>(`/api/listings/${encodeURIComponent(slug)}/reopen`);
}

export function deleteApiListing(slug: string): Promise<{ ok: boolean }> {
  return apiDelete<{ ok: boolean }>(`/api/listings/${encodeURIComponent(slug)}`);
}

export function claimApiSpot(spotId: string, assets?: { website?: string; logoUrl?: string }): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/claim`, { ...(assets ?? {}) });
}

export function bidApiSpot(spotId: string, amount: number, assets?: { website?: string; logoUrl?: string }): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/bid`, { amount, ...(assets ?? {}) });
}

export function submitSpotArtwork(spotId: string, assets: { website?: string; logoUrl?: string }): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/artwork`, { ...(assets ?? {}) });
}

export function submitSpotProof(spotId: string, proof: { photos: string[]; postUrl?: string }): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/proof`, proof);
}

export function confirmSpotReceipt(spotId: string): Promise<ApiSpot> {
  return apiPostEmpty<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/confirm`);
}

export function disputeSpotDelivery(spotId: string, reason: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/dispute`, { reason });
}

export function withdrawSpotDispute(spotId: string): Promise<ApiSpot> {
  return apiPostEmpty<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/withdraw`);
}

export function fetchSellerDashboard(): Promise<SellerDashboard> {
  return apiGet<SellerDashboard>("/api/seller/dashboard");
}

export function fetchSponsorDashboard(): Promise<SponsorDashboard> {
  return apiGet<SponsorDashboard>("/api/sponsor/dashboard");
}

export function fetchReviewQueue(): Promise<ApiListing[]> {
  return apiGet<ApiListing[]>("/api/review/queue");
}

export function approveReviewListing(slug: string, policy: ReviewPolicyRequest): Promise<ApiListing> {
  return apiPost<ApiListing>(`/api/listings/${encodeURIComponent(slug)}/approve`, policy);
}

export function rejectReviewListing(slug: string, reason: string): Promise<ApiListing> {
  return apiPost<ApiListing>(`/api/listings/${encodeURIComponent(slug)}/reject`, { reason });
}

export function fetchTerms(): Promise<TermsDoc> {
  return apiGet<TermsDoc>("/api/terms");
}

export function acceptListingTerms(slug: string, version: string): Promise<ApiListing> {
  return apiPost<ApiListing>(`/api/listings/${encodeURIComponent(slug)}/accept-terms`, { version });
}

export function approveApiSpot(spotId: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/approve`, {});
}

export function rejectApiSpot(spotId: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/reject`, {});
}

export function fulfillApiSpot(spotId: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/fulfill`, {});
}

export function fetchPayableQueue(): Promise<PayoutItem[]> {
  return apiGet<PayoutItem[]>("/api/review/payable");
}
export function refundApiSpot(spotId:string):Promise<ApiSpot>{return apiPostEmpty<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/refund`)}

export function fetchDisputeQueue(): Promise<DisputeItem[]> {
  return apiGet<DisputeItem[]>("/api/review/disputes");
}
export function reconcileChain():Promise<{checked:number;updated:number;missing:number}>{return apiPostEmpty('/api/review/reconcile')}

export function resolveSpotDispute(spotId: string, sellerShareBps: number, decision: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/resolve`, { sellerShareBps, decision });
}

export function payApiSpot(spotId: string, reference: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/pay`, { reference });
}

/** Exchange the Privy access token for an API session cookie. */
export async function createApiSession(): Promise<SessionUser> {
  const token = await getAccessToken();
  if (!token) throw new Error("not signed in with X");
  let identityToken: string | null = null;
  try {
    identityToken = await getIdentityToken();
  } catch {
    identityToken = null;
  }
  const session = await request<SessionUser>("/api/auth/session", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(identityToken ? { "privy-id-token": identityToken } : {}),
    },
  });
  csrfToken = session.csrfToken;
  return session;
}

export async function fetchApiMe(): Promise<SessionUser> {
  const session = await apiGet<SessionUser>("/api/auth/me");
  csrfToken = session.csrfToken;
  return session;
}

export async function logoutApiSession(): Promise<{ ok: boolean }> {
  try { return await apiPost<{ ok: boolean }>("/api/auth/logout", {}); }
  finally { csrfToken = null; }
}
