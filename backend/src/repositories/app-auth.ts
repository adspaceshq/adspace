import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { isOwnUpload } from "../cloudinary.js";
import {
  parseBio,
  parseOnboarding,
  parsePayoutWallet,
  sessionTtlMs,
  type AuthRepository,
  type ProfileRepository,
  type StoredSession,
} from "../db.js";
import type { AuthenticatedIdentity, Onboarding, PublicProfile, SessionUser, UpdateProfileRequest } from "../types.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const stripAt = (handle: string) => handle.trim().replace(/^@+/, "");
const RESERVED_HANDLES = new Set(["admin", "api", "browse", "dashboard", "review", "sell", "settings", "wallet", "onboarding", "activity", "notifications", "watchlist", "adspaces", "support", "help", "terms", "privacy", "fees", "content-policy"]);

export function parseHandle(value: unknown): string {
  const handle = stripAt(String(value ?? ""));
  if (!/^[A-Za-z0-9_]{3,30}$/.test(handle)) throw new HttpError("handles are 3-30 letters, numbers or underscores", 400);
  if (RESERVED_HANDLES.has(handle.toLowerCase())) throw new HttpError("that handle is reserved", 400);
  return handle;
}

class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type UserRow = typeof users.$inferSelect;

// The API keeps its existing contract: X users are shown as `@name`, others as `user-xxxxxxxx`.
function toSessionUser(row: UserRow): SessionUser {
  const hasX = Boolean(row.xUserId);
  return {
    id: row.id,
    did: row.privyDid,
    handle: hasX ? `@${row.handle}` : row.handle,
    name: row.displayName || undefined,
    avatar: row.avatarUrl ?? undefined,
    email: row.email ?? undefined,
    walletAddress: row.walletAddress ?? undefined,
    hasX,
    emailVerified: Boolean(row.email && row.emailVerifiedAt),
  };
}

function toProfile(row: UserRow, includePrivate: boolean): PublicProfile {
  const user = toSessionUser(row);
  return {
    id: row.id,
    handle: user.handle,
    displayName: row.displayName || undefined,
    avatar: row.avatarUrl ?? undefined,
    bio: row.bio,
    ...(includePrivate && row.payoutWallet ? { payoutWallet: row.payoutWallet } : {}),
    verified: row.verified,
  };
}

export class AppAuthRepository implements AuthRepository, ProfileRepository {
  constructor(private readonly db: Db) {}

  async createSession(identity: AuthenticatedIdentity): Promise<{ token: string; session: StoredSession }> {
    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    try {
      const user = await this.db.transaction(async (trx) => {
        const [existing] = await trx.select().from(users).where(eq(users.privyDid, identity.did)).for("update");
        if (existing?.xUserId && identity.xUserId && existing.xUserId !== identity.xUserId) {
          throw new HttpError("X account identity does not match this user", 409);
        }
        const values = {
          privyDid: identity.did,
          xUserId: identity.xUserId ?? null,
          handle: stripAt(identity.handle),
          displayName: identity.name ?? stripAt(identity.handle),
          avatarUrl: identity.avatar ?? null,
          email: identity.email ?? null,
          emailVerifiedAt: identity.email ? new Date() : null,
          walletAddress: identity.walletAddress ?? null,
        };
        const [row] = await trx
          .insert(users)
          .values(values)
          .onConflictDoUpdate({
            target: users.privyDid,
            set: {
              xUserId: sql`COALESCE(EXCLUDED.x_user_id, ${users.xUserId})`,
              // X users keep their X username; everyone else keeps the handle they picked.
              handle: identity.xUserId ? values.handle : sql`${users.handle}`,
              // Profile edits win over the identity provider after the first sign-in.
              displayName: sql`${users.displayName}`,
              avatarUrl: sql`COALESCE(${users.avatarUrl}, EXCLUDED.avatar_url)`,
              email: sql`COALESCE(EXCLUDED.email, ${users.email})`,
              emailVerifiedAt: sql`CASE
                WHEN EXCLUDED.email IS NULL THEN ${users.emailVerifiedAt}
                WHEN EXCLUDED.email = ${users.email} AND ${users.emailVerifiedAt} IS NOT NULL THEN ${users.emailVerifiedAt}
                ELSE now() END`,
              walletAddress: sql`COALESCE(EXCLUDED.wallet_address, ${users.walletAddress})`,
              updatedAt: new Date(),
            },
          })
          .returning();
        await trx.insert(sessions).values({ tokenHash: digest(token), userId: row.id, csrfToken, expiresAt });
        await trx.delete(sessions).where(lte(sessions.expiresAt, new Date()));
        return row;
      });
      return { token, session: { user: toSessionUser(user), csrfToken, expiresAt } };
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23505") throw new HttpError("This identity is already linked to another user", 409);
      throw error;
    }
  }

  async readSession(token: string | undefined): Promise<StoredSession | undefined> {
    if (!token) return undefined;
    const [row] = await this.db
      .select({ user: users, csrfToken: sessions.csrfToken, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, digest(token)), gt(sessions.expiresAt, new Date())));
    if (!row) return undefined;
    return { user: toSessionUser(row.user), csrfToken: row.csrfToken, expiresAt: row.expiresAt };
  }

  async destroySession(token: string | undefined): Promise<void> {
    if (token) await this.db.delete(sessions).where(eq(sessions.tokenHash, digest(token)));
  }

  // Users are created in createSession; nothing to do here.
  async upsertFromSession(): Promise<void> {}

  async getProfileByHandle(handle: string): Promise<PublicProfile | undefined> {
    const clean = stripAt(handle).toLowerCase();
    if (!clean) return undefined;
    const [row] = await this.db.select().from(users).where(sql`lower(${users.handle}) = ${clean}`);
    return row ? toProfile(row, false) : undefined;
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<PublicProfile> {
    const changes: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (patch.displayName !== undefined) {
      const name = String(patch.displayName).trim();
      if (!name || name.length > 60) throw new HttpError("display name must be 1-60 characters", 400);
      changes.displayName = name;
    }
    if (patch.avatar !== undefined) {
      if (patch.avatar !== null && !isOwnUpload(String(patch.avatar), "avatars")) throw new HttpError("avatar must be an uploaded image", 400);
      changes.avatarUrl = patch.avatar;
    }
    if (patch.handle !== undefined) {
      const [current] = await this.db.select({ xUserId: users.xUserId }).from(users).where(eq(users.id, userId));
      if (current?.xUserId) throw new HttpError("your handle follows your X username", 400);
      const handle = parseHandle(patch.handle);
      if (!(await this.isHandleAvailable(handle, userId))) throw new HttpError("that handle is taken", 409);
      changes.handle = handle;
    }
    if (patch.bio !== undefined) changes.bio = parseBio(patch.bio);
    if (patch.payoutWallet !== undefined) changes.payoutWallet = parsePayoutWallet(patch.payoutWallet) || null;
    const [row] = await this.db.update(users).set(changes).where(eq(users.id, userId)).returning();
    if (!row) throw new HttpError("user not found", 404);
    return toProfile(row, true);
  }

  async isHandleAvailable(handle: string, exceptUserId?: string): Promise<boolean> {
    const [row] = await this.db.select({ id: users.id }).from(users).where(sql`lower(${users.handle}) = ${handle.toLowerCase()}`);
    return !row || row.id === exceptUserId;
  }

  async getOnboarding(userId: string): Promise<Onboarding | null> {
    const [row] = await this.db.select({ onboarding: users.onboarding }).from(users).where(eq(users.id, userId));
    return (row?.onboarding as Onboarding | null | undefined) ?? null;
  }

  async saveOnboarding(userId: string, input: unknown): Promise<Onboarding> {
    const onboarding = parseOnboarding(input);
    const [user] = await this.db.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt }).from(users).where(eq(users.id, userId));
    if (!user) throw new HttpError("user not found", 404);
    if (!user.email || !user.emailVerifiedAt) throw new HttpError("verify your email first", 403);
    const [row] = await this.db
      .update(users)
      .set({
        onboarding: onboarding as unknown as Record<string, unknown>,
        intent: onboarding.accountType === "creator" ? "sell" : onboarding.accountType,
        onboardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId))
      .returning({ id: users.id });
    if (!row) throw new HttpError("user not found", 404);
    return onboarding;
  }
}
