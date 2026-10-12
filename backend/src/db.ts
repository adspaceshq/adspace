import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { BRAND_CATEGORIES, SOCIAL_PLATFORMS, type AuthenticatedIdentity, type BrandCategory, type Onboarding, type PublicProfile, type SocialPlatform, type SessionUser, type UpdateProfileRequest } from "./types.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 168) * 60 * 60 * 1000;

export interface StoredSession { user: SessionUser; csrfToken: string; expiresAt: Date }
export interface AuthRepository {
  createSession(identity: AuthenticatedIdentity): Promise<{ token: string; session: StoredSession }>;
  readSession(token: string | undefined): Promise<StoredSession | undefined>;
  destroySession(token: string | undefined): Promise<void>;
  close?(): Promise<void>;
}

/** Profile store, implemented by repositories/app-auth.ts. */
export interface ProfileRepository {
  /** Ensure a row exists for a freshly logged-in session user (no-op when already present). */
  upsertFromSession(user: SessionUser): Promise<void>;
  getProfileByHandle(handle: string): Promise<PublicProfile | undefined>;
  updateProfile(userId: string, patch: UpdateProfileRequest): Promise<PublicProfile>;
  getOnboarding(userId: string): Promise<Onboarding | null>;
  saveOnboarding(userId: string, input: unknown): Promise<Onboarding>;
}

/** Bio: trimmed, at most 280 chars. */
export function parseBio(value: unknown): string {
  const bio = typeof value === "string" ? value.trim() : "";
  if (bio.length > 280) throw Object.assign(new Error("bio must be at most 280 characters"), { status: 400 });
  return bio;
}

/** Payout wallet: empty clears it, otherwise a Solana base58 address (32–44 chars). */
export function parsePayoutWallet(value: unknown): string {
  const wallet = typeof value === "string" ? value.trim() : "";
  if (!wallet) return "";
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
    throw Object.assign(new Error("payout wallet must be a Solana address"), { status: 400 });
  }
  return wallet;
}

/** Validates the creator/sponsor onboarding payload; throws a 400 on bad input. */
export function parseOnboarding(value: unknown): Onboarding {
  const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
  const body = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  if (body.accountType === "both") {
    const creator = parseOnboarding({ ...body, accountType: "creator" }).creator!;
    const sponsor = parseOnboarding({ ...body, accountType: "sponsor" }).sponsor!;
    return { accountType: "both", creator, sponsor };
  }
  if (body.accountType === "creator") {
    const raw = (body.creator && typeof body.creator === "object" ? (body.creator as { socials?: unknown }).socials : undefined);
    const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const socials: Partial<Record<SocialPlatform, string>> = {};
    for (const platform of SOCIAL_PLATFORMS) {
      const entry = typeof input[platform] === "string" ? (input[platform] as string).trim() : "";
      if (!entry) continue;
      if (entry.length > 100) throw bad(`${platform} handle is too long`);
      socials[platform] = entry;
    }
    if (Object.keys(socials).length === 0) throw bad("add at least one social account");
    return { accountType: "creator", creator: { socials } };
  }
  if (body.accountType === "sponsor") {
    const raw = (body.sponsor && typeof body.sponsor === "object" ? body.sponsor : {}) as Record<string, unknown>;
    const brandName = typeof raw.brandName === "string" ? raw.brandName.trim() : "";
    if (!brandName || brandName.length > 80) throw bad("brand name is required (max 80 characters)");
    if (!BRAND_CATEGORIES.includes(raw.category as BrandCategory)) throw bad("pick a brand category");
    const website = typeof raw.website === "string" ? raw.website.trim() : "";
    if (website && (website.length > 200 || !/^https?:\/\/[^\s]+\.[^\s]+$/i.test(website))) throw bad("website must be a valid http(s) URL");
    return { accountType: "sponsor", sponsor: { brandName, category: raw.category as BrandCategory, ...(website ? { website } : {}) } };
  }
  throw bad("accountType must be creator, sponsor or both");
}

export function createDatabasePool(
  connectionString = process.env.DATABASE_URL,
  options: { max?: number } = {},
): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required for persistence");
  const databaseUrl = new URL(connectionString);
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) databaseUrl.searchParams.delete(parameter);
  const caPath = process.env.DATABASE_CA_CERT;
  const ssl = process.env.DATABASE_SSL === "disable"
    ? false
    : {
        rejectUnauthorized: process.env.DATABASE_SSL !== "no-verify",
        ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}),
      };
  return new Pool({
    connectionString: databaseUrl.toString(),
    ssl,
    max: options.max ?? Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
}

export function csrfMatches(session: StoredSession, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(session.csrfToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const sessionTtlMs = SESSION_TTL_MS;
