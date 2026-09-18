import { getAccessToken, getIdentityToken } from "@privy-io/react-auth";
import type {
  ApiCreateListingRequest,
  ApiListing,
  ApiListingSummary,
  ApiSpot,
  SessionUser,
  SellerDashboard,
} from "./types";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
let csrfToken: string | null = null;

async function parseError(res: Response): Promise<string> {
  const err = await res.json().catch(() => ({ error: res.statusText }));
  return (err as { error?: string }).error ?? `request failed: ${res.status}`;
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
  if (!res.ok) throw new Error(await parseError(res));
  return res.json() as Promise<T>;
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

export function fetchListingSummaries(): Promise<ApiListingSummary[]> {
  return apiGet<ApiListingSummary[]>("/api/listings");
}

export function fetchListing(slug: string): Promise<ApiListing> {
  return apiGet<ApiListing>(`/api/listings/${encodeURIComponent(slug)}`);
}

export function createApiListing(req: ApiCreateListingRequest): Promise<ApiListing> {
  return apiPost<ApiListing>("/api/listings", req);
}

export function claimApiSpot(spotId: string): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/claim`, {});
}

export function bidApiSpot(spotId: string, amount: number): Promise<ApiSpot> {
  return apiPost<ApiSpot>(`/api/spots/${encodeURIComponent(spotId)}/bid`, { amount });
}

export function fetchSellerDashboard(): Promise<SellerDashboard> {
  return apiGet<SellerDashboard>("/api/seller/dashboard");
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
