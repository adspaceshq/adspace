import express, { type Router } from "express";
import cookieParser from "cookie-parser";
import { privyConfigured } from "./auth.js";
import { adspacesProgramId, type SolanaCluster } from "./config.js";

export interface AppDependencies {
  frontendUrl?: string;
  trustProxy?: number;
  chain?: { cluster: SolanaCluster; programId: string };
  /** The API on the app schema, mounted at /api/v2. */
  v2Router?: Router;
}

export function createApp({
  frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000",
  trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : undefined,
  chain = { cluster: "devnet", programId: adspacesProgramId },
  v2Router,
}: AppDependencies = {}) {
  const app = express();
  if (trustProxy !== undefined) app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  // JSON-only API: never sniffed, framed or cached by intermediaries, and always over https.
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (req.headers.origin === frontendUrl) res.header("Access-Control-Allow-Origin", frontendUrl);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, privy-id-token");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });

  if (v2Router) app.use("/api/v2", v2Router);

  app.get("/health", (_req, res) => res.json({
    status: "ok",
    auth: privyConfigured ? "privy" : "unconfigured",
    sessions: "postgres",
    chain: { cluster: chain.cluster, programId: chain.programId },
  }));
  return app;
}
