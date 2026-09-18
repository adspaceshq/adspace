import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import type { AuthenticatedIdentity, SessionUser } from "./types.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 168) * 60 * 60 * 1000;

export interface StoredSession { user: SessionUser; csrfToken: string; expiresAt: Date }
export interface AuthRepository {
  createSession(identity: AuthenticatedIdentity): Promise<{ token: string; session: StoredSession }>;
  readSession(token: string | undefined): Promise<StoredSession | undefined>;
  destroySession(token: string | undefined): Promise<void>;
  close?(): Promise<void>;
}

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function createDatabasePool(connectionString = process.env.DATABASE_URL): Pool {
  if (!connectionString) throw new Error("DATABASE_URL is required for persistence");
  const databaseUrl = new URL(connectionString);
  for (const parameter of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) databaseUrl.searchParams.delete(parameter);
  const caPath = process.env.DATABASE_CA_CERT;
  const ssl = process.env.DATABASE_SSL === "disable" ? false : { rejectUnauthorized: true, ...(caPath ? { ca: readFileSync(caPath, "utf8") } : {}) };
  return new Pool({ connectionString: databaseUrl.toString(), ssl, max: Number(process.env.DATABASE_POOL_SIZE ?? 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
}

export class PostgresAuthRepository implements AuthRepository {
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
      const existing = await client.query<{ id: string; x_user_id: string }>("SELECT id, x_user_id FROM users WHERE privy_did = $1 FOR UPDATE", [identity.did]);
      if (existing.rows[0] && existing.rows[0].x_user_id !== identity.xUserId) throw Object.assign(new Error("X account identity does not match this user"), { status: 409 });
      const userId = existing.rows[0]?.id ?? randomUUID();
      await client.query(`INSERT INTO users (id, privy_did, x_user_id, x_handle, display_name, avatar_url)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (privy_did) DO UPDATE SET
        x_handle=EXCLUDED.x_handle, display_name=EXCLUDED.display_name, avatar_url=EXCLUDED.avatar_url, updated_at=now()`,
      [userId, identity.did, identity.xUserId, identity.handle, identity.name ?? null, identity.avatar ?? null]);
      const token = randomBytes(32).toString("base64url");
      const csrfToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
      await client.query("INSERT INTO sessions (token_hash,user_id,csrf_token,expires_at) VALUES ($1,$2,$3,$4)", [digest(token), userId, csrfToken, expiresAt]);
      await client.query("DELETE FROM sessions WHERE expires_at <= now()");
      await client.query("COMMIT");
      return { token, session: { user: { id: userId, did: identity.did, handle: identity.handle, name: identity.name, avatar: identity.avatar }, csrfToken, expiresAt } };
    } catch (error) {
      await client.query("ROLLBACK");
      if ((error as { code?: string }).code === "23505") throw Object.assign(new Error("X account is already linked to another user"), { status: 409 });
      throw error;
    } finally { client.release(); }
  }
  async readSession(token: string | undefined): Promise<StoredSession | undefined> {
    if (!token) return undefined;
    const result = await this.pool.query<{ id:string; privy_did:string; x_handle:string; display_name:string|null; avatar_url:string|null; csrf_token:string; expires_at:Date }>(
      `SELECT u.id,u.privy_did,u.x_handle,u.display_name,u.avatar_url,s.csrf_token,s.expires_at
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()`, [digest(token)]);
    const row = result.rows[0];
    if (!row) return undefined;
    return { user: { id: row.id, did: row.privy_did, handle: row.x_handle, name: row.display_name ?? undefined, avatar: row.avatar_url ?? undefined }, csrfToken: row.csrf_token, expiresAt: row.expires_at };
  }
  async destroySession(token: string | undefined): Promise<void> { if (token) await this.pool.query("DELETE FROM sessions WHERE token_hash=$1", [digest(token)]); }
  async close(): Promise<void> { await this.pool.end(); }
}

export function csrfMatches(session: StoredSession, supplied: string | undefined): boolean {
  if (!supplied) return false;
  const actual = Buffer.from(supplied);
  const expected = Buffer.from(session.csrfToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const sessionTtlMs = SESSION_TTL_MS;
