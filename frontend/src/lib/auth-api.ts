import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";
import type {
  ApiCreateListingRequest,
  ApiListing,
  ApiListingSummary,
  Onboarding,
  ApiSpot,
  SessionUser,
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

/**
 * Mutations pair the session cookie with the in-memory CSRF token. If a
 * background session rotation landed a fresh cookie after we read the token,
 * the first attempt 403s — refresh the session once and retry with the new
 * pair instead of surfacing "invalid CSRF token".
 */
async function withCsrfRetry<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } catch (e) {
    if (e instanceof ApiError && e.status === 403 && /csrf/i.test(e.message)) {
      await fetchApiMe();
      return await send();
    }
    throw e;
  }
}

/** Owner POST without a body: session cookie + Privy Bearer + CSRF. */
export async function apiPostEmpty<T>(path: string): Promise<T> {
  return withCsrfRetry(async () => {
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
  });
}

/** Authenticated POST: session cookie + Privy Bearer so the API can verify X. */
export async function apiPost<T>(path: string, body: unknown = {}): Promise<T> {
  return withCsrfRetry(async () => {
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
  });
}

export async function apiGet<T>(path: string): Promise<T> {
  let token: string | null = null;
  let identityToken: string | null = null;
  try {
    token = await getAccessToken();
  } catch {
    token = null;
  }
  try {
    identityToken = await getIdentityToken();
  } catch {
    identityToken = null;
  }
  return request<T>(path, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(identityToken ? { "privy-id-token": identityToken } : {}),
    },
  });
}

export async function saveOnboarding(input: Onboarding): Promise<Onboarding> {
  return withCsrfRetry(async () => {
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
  });
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
