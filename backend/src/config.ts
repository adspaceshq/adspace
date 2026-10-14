const DEFAULT_ADSPACES_PROGRAM_ID = "8Vg24teSaNrY4AmksQ8hZw2z2RRPuobeCtir7jVTYGw5";

export type SolanaCluster = "devnet" | "testnet" | "mainnet-beta";

export interface AppConfig {
  port: number;
  frontendUrl: string;
  trustProxy?: number;
  databaseUrl: string;
  databasePoolSize: number;
  sessionTtlHours: number;
  /** X handles or stable user IDs allowed to review submissions (Step 3). */
  platformReviewers: string[];
  solana: { cluster: SolanaCluster; programId: string; rpcUrl?: string; websocketUrl?: string; reviewerWalletPath?: string };
}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function optionalNonNegativeInteger(name: string, value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative integer`);
  return parsed;
}

function absoluteUrl(name: string, value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} must be an absolute URL`); }
  if (!new Set(["http:", "https:", "ws:", "wss:", "postgres:", "postgresql:"]).has(parsed.protocol)) {
    throw new Error(`${name} has an unsupported protocol`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function cluster(value: string | undefined): SolanaCluster {
  const selected = value ?? "devnet";
  if (selected !== "devnet" && selected !== "testnet" && selected !== "mainnet-beta") {
    throw new Error("SOLANA_NETWORK must be devnet, testnet, or mainnet-beta");
  }
  return selected;
}

function programId(value: string | undefined): string {
  const selected = value ?? DEFAULT_ADSPACES_PROGRAM_ID;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(selected)) throw new Error("ADSPACES_PROGRAM_ID must be a base58 public key");
  return selected;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const databaseUrl = absoluteUrl("DATABASE_URL", env.DATABASE_URL);
  if (!databaseUrl.startsWith("postgres://") && !databaseUrl.startsWith("postgresql://")) {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }
  return {
    port: positiveInteger("PORT", env.PORT, 8080),
    frontendUrl: absoluteUrl("FRONTEND_URL", env.FRONTEND_URL ?? "http://localhost:3000"),
    trustProxy: optionalNonNegativeInteger("TRUST_PROXY", env.TRUST_PROXY),
    databaseUrl,
    databasePoolSize: positiveInteger("DATABASE_POOL_SIZE", env.DATABASE_POOL_SIZE, 10),
    sessionTtlHours: positiveInteger("SESSION_TTL_HOURS", env.SESSION_TTL_HOURS, 168),
    platformReviewers: (env.PLATFORM_REVIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    solana: {
      cluster: cluster(env.SOLANA_NETWORK),
      programId: programId(env.ADSPACES_PROGRAM_ID),
      rpcUrl: env.SOLANA_RPC_URL ? absoluteUrl("SOLANA_RPC_URL", env.SOLANA_RPC_URL) : undefined,
      websocketUrl: env.SOLANA_WEBSOCKET_URL ? absoluteUrl("SOLANA_WEBSOCKET_URL", env.SOLANA_WEBSOCKET_URL) : undefined,
      reviewerWalletPath: env.ADSPACES_REVIEWER_KEYPAIR?.trim() || env.ADSPACES_REVIEWER_KEYPAIR_PATH?.trim() || undefined,
    },
  };
}

export const adspacesProgramId = DEFAULT_ADSPACES_PROGRAM_ID;
