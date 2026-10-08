import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { BRAND_CATEGORIES, SOCIAL_PLATFORMS, type AuthenticatedIdentity, type BrandCategory, type Onboarding, type PublicProfile, type SocialPlatform, SessionUser, UpdateProfileRequest } from "./types.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 168) * 60 * 60 * 1000;

export interface StoredSession { user: SessionUser; csrfToken: string; expiresAt: Date }
export interface AuthRepository {
  createSession(identity: AuthenticatedIdentity): Promise<{ token: string; session: StoredSession }>;
  readSession(token: string | undefined): Promise<StoredSession | undefined>;
  destroySession(token: string | undefined): Promise<void>;
  close?(): Promise<void>;
}

/** Step 1 profile store. Postgres is the source of truth; memory is the test/demo adapter. */
export interface ProfileRepository {
  /** Ensure a row exists for a freshly logged-in session user (no-op when already present). */
  upsertFromSession(user: SessionUser): Promise<void>;
  getProfileByHandle(handle: string): Promise<PublicProfile | undefined>;
  updateProfile(userId: string, patch: UpdateProfileRequest): Promise<PublicProfile>;
  getOnboarding(userId: string): Promise<Onboarding | null>;
  saveOnboarding(userId: string, input: unknown): Promise<Onboarding>;
}

/** URL handle without @, lowercase: `@NotCodeSid` → `notcodesid`. */
export function normalizeHandle(handle: string | undefined | null): string {
  return (handle ?? "").trim().replace(/^@+/, "").toLowerCase();
}

/**
 * Step 3: platform reviewers are named in PLATFORM_REVIEWERS. Each entry
 * matches an X handle (case-insensitive, `@` optional) or a stable user ID —
 * so a handle rename never locks the operator out when the ID is listed.
 */
export function isReviewer(user: Pick<SessionUser, "id" | "handle">, reviewers: readonly string[]): boolean {
  const cleanHandle = normalizeHandle(user.handle);
  return reviewers.some((entry) => {
    const clean = entry.trim();
    if (!clean) return false;
    return clean === user.id || normalizeHandle(clean) === cleanHandle;
  });
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

/** In-memory ProfileRepository for tests and the demo adapter. */
export class MemoryProfileRepository implements ProfileRepository {
  private byUserId = new Map<string, { user: SessionUser; bio: string; payoutWallet: string }>();
  private onboarding = new Map<string, Onboarding>();

  async getOnboarding(userId: string): Promise<Onboarding | null> { return this.onboarding.get(userId) ?? null; }

  async saveOnboarding(userId: string, input: unknown): Promise<Onboarding> {
    if (!this.byUserId.has(userId)) throw Object.assign(new Error("profile not found"), { status: 404 });
    const parsed = parseOnboarding(input);
    this.onboarding.set(userId, parsed);
    return parsed;
  }

  async upsertFromSession(user: SessionUser): Promise<void> {
    const existing = this.byUserId.get(user.id);
    if (existing) {
      existing.user = { ...user };
      return;
    }
    this.byUserId.set(user.id, { user: { ...user }, bio: "", payoutWallet: "" });
  }

  async getProfileByHandle(handle: string): Promise<PublicProfile | undefined> {
    const clean = normalizeHandle(handle);
    if (!clean) return undefined;
    for (const record of this.byUserId.values()) {
      if (normalizeHandle(record.user.handle) === clean) return this.toProfile(record);
    }
    return undefined;
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<PublicProfile> {
    const record = this.byUserId.get(userId);
    if (!record) throw Object.assign(new Error("profile not found"), { status: 404 });
    if (patch.bio !== undefined) record.bio = parseBio(patch.bio);
    if (patch.payoutWallet !== undefined) record.payoutWallet = parsePayoutWallet(patch.payoutWallet);
    return this.toProfile(record);
  }

  private toProfile(record: { user: SessionUser; bio: string; payoutWallet: string }): PublicProfile {
    const profile: PublicProfile = {
      id: record.user.id,
      handle: record.user.handle,
      bio: record.bio,
      verified: true,
    };
    if (record.user.name) profile.displayName = record.user.name;
    if (record.user.avatar) profile.avatar = record.user.avatar;
    if (record.payoutWallet) profile.payoutWallet = record.payoutWallet;
    return profile;
  }
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

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

type ProfileRow = {
  id: string; x_handle: string; display_name: string | null; avatar_url: string | null;
  bio: string | null; payout_wallet: string | null; verified: boolean | null;
};

function mapProfileRow(row: ProfileRow): PublicProfile {
  const profile: PublicProfile = {
    id: row.id,
    handle: row.x_handle,
    bio: row.bio ?? "",
    verified: row.verified ?? true,
  };
  if (row.display_name) profile.displayName = row.display_name;
  if (row.avatar_url) profile.avatar = row.avatar_url;
  if (row.payout_wallet) profile.payoutWallet = row.payout_wallet;
  return profile;
}

export class PostgresAuthRepository implements AuthRepository, ProfileRepository {
  private pool: Pool;
  constructor(poolOrConnection?: Pool | string) { this.pool = poolOrConnection instanceof Pool ? poolOrConnection : createDatabasePool(poolOrConnection); }
  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id uuid PRIMARY KEY, privy_did text NOT NULL UNIQUE, x_user_id text NOT NULL UNIQUE,
        x_handle text NOT NULL, display_name text, avatar_url text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS payout_wallet text NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT true;
      ALTER TABLE users ALTER COLUMN x_user_id DROP NOT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address text;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding jsonb;
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
          REVOKE ALL ON users, sessions FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
          REVOKE ALL ON users, sessions FROM authenticated;
        END IF;
      END $$;
    `);
  }
  async createSession(identity: AuthenticatedIdentity): Promise<{ token: string; session: StoredSession }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string; x_user_id: string | null }>("SELECT id, x_user_id FROM users WHERE privy_did = $1 FOR UPDATE", [identity.did]);
      if (existing.rows[0]?.x_user_id && identity.xUserId && existing.rows[0].x_user_id !== identity.xUserId) {
        throw Object.assign(new Error("X account identity does not match this user"), { status: 409 });
      }
      const userId = existing.rows[0]?.id ?? randomUUID();
      await client.query(`INSERT INTO users (id, privy_did, x_user_id, x_handle, display_name, avatar_url, email, wallet_address)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (privy_did) DO UPDATE SET
        x_user_id=COALESCE(EXCLUDED.x_user_id, users.x_user_id),
        x_handle=EXCLUDED.x_handle, display_name=COALESCE(EXCLUDED.display_name, users.display_name),
        avatar_url=COALESCE(EXCLUDED.avatar_url, users.avatar_url),
        email=COALESCE(EXCLUDED.email, users.email),
        wallet_address=COALESCE(EXCLUDED.wallet_address, users.wallet_address), updated_at=now()`,
      [userId, identity.did, identity.xUserId ?? null, identity.handle, identity.name ?? null, identity.avatar ?? null, identity.email ?? null, identity.walletAddress ?? null]);
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await client.query("INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)", [digest(token), userId, csrfToken, expiresAt]);
      await client.query("DELETE FROM sessions WHERE expires_at <= now()");
      await client.query("COMMIT");
      return { token, session: { user: { id: userId, did: identity.did, handle: identity.handle, name: identity.name, avatar: identity.avatar, email: identity.email, walletAddress: identity.walletAddress, hasX: identity.hasX }, csrfToken, expiresAt } };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("This identity is already linked to another user"), { status: 409 });
      throw error;
    } finally { client.release(); }
  }
  async readSession(token: string | undefined): Promise<StoredSession | undefined> {
    if (!token) return undefined;
    const result = await this.pool.query<{ id:string; privy_did:string; x_handle:string; x_user_id:string|null; display_name:string|null; avatar_url:string|null; email:string|null; wallet_address:string|null; csrf_token:string; expires_at:Date }>(
      `SELECT u.id,u.privy_did,u.x_handle,u.x_user_id,u.display_name,u.avatar_url,u.email,u.wallet_address,s.csrf_token,s.expires_at
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(token)]);
    const row = result.rows[0];
    if (!row) return undefined;
    return { user: { id: row.id, did: row.privy_did, handle: row.x_handle, name: row.display_name ?? undefined, avatar: row.avatar_url ?? undefined, email: row.email ?? undefined, walletAddress: row.wallet_address ?? undefined, hasX: Boolean(row.x_user_id) }, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }
  async destroySession(token: string | undefined): Promise<void> { if (token) await this.pool.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]); }
  async close(): Promise<void> { await this.pool.end(); }

  async upsertFromSession(): Promise<void> {
    // The users row is already created/updated inside createSession's
    // transaction, so there is nothing extra to do for Postgres.
  }

  async getProfileByHandle(handle: string): Promise<PublicProfile | undefined> {
    const clean = normalizeHandle(handle);
    if (!clean) return undefined;
    const result = await this.pool.query(
      `SELECT id, x_handle, display_name, avatar_url, bio, payout_wallet, verified
       FROM users WHERE LOWER(REPLACE(x_handle, '@', '')) = $1 LIMIT 1`,
      [clean],
    );
    const row = result.rows[0];
    return row ? mapProfileRow(row) : undefined;
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<PublicProfile> {
    const bio = patch.bio !== undefined ? parseBio(patch.bio) : undefined;
    const payoutWallet = patch.payoutWallet !== undefined ? parsePayoutWallet(patch.payoutWallet) : undefined;
    const result = await this.pool.query(
      `UPDATE users SET
         bio = COALESCE($2, bio),
         payout_wallet = COALESCE($3, payout_wallet),
         updated_at = now()
       WHERE id = $1
       RETURNING id, x_handle, display_name, avatar_url, bio, payout_wallet, verified`,
      [userId, bio ?? null, payoutWallet ?? null],
    );
    const row = result.rows[0];
    if (!row) throw Object.assign(new Error("profile not found"), { status: 404 });
    return mapProfileRow(row);
  }
  async getOnboarding(userId: string): Promise<Onboarding | null> {
    const result = await this.pool.query<{ onboarding: Onboarding | null }>("SELECT onboarding FROM users WHERE id = $1", [userId]);
    return result.rows[0]?.onboarding ?? null;
  }

  async saveOnboarding(userId: string, input: unknown): Promise<Onboarding> {
    const parsed = parseOnboarding(input);
    const result = await this.pool.query("UPDATE users SET onboarding = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING id", [userId, JSON.stringify(parsed)]);
    if (!result.rows[0]) throw Object.assign(new Error("profile not found"), { status: 404 });
    return parsed;
  }
}

export function csrfMatches(session: StoredSession, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(session.csrfToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const sessionTtlMs = SESSION_TTL_MS;
