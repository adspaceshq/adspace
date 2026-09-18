import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { pathToFileURL } from "node:url";
import { Store } from "./store.js";
import { cookieOptions, privyConfigured, sessionCookieName, userFromAccessToken } from "./auth.js";
import { csrfMatches, PostgresAuthRepository, type AuthRepository, type StoredSession } from "./db.js";
import { createDatabasePool } from "./db.js";
import { PostgresMarketplaceRepository, type MarketplaceRepository } from "./market.js";
import type { AuthenticatedIdentity, CreateListingRequest, SessionUser } from "./types.js";

declare global { namespace Express { interface Request { user?: SessionUser; authSession?: StoredSession } } }

export interface AppDependencies { auth: AuthRepository; verifyToken?: (token: string, identityToken?: string) => Promise<AuthenticatedIdentity>; market?: MarketplaceRepository; store?: Store }

const sendErr = (res: Response, e: unknown) => {
  const status = (e as { status?: number }).status ?? 500;
  res.status(status).json({ error: status === 500 ? "internal error" : e instanceof Error ? e.message : "request failed" });
};

export function createApp({ auth, verifyToken = userFromAccessToken, market, store = new Store() }: AppDependencies) {
  const repo: MarketplaceRepository = market ?? {
    migrate: () => store.migrate(), summaries: async () => store.summaries(), get: async slug => store.get(slug),
    create: async (body, seller) => store.createForUser(body, seller), update: async (slug,user,patch) => store.update(slug,user,patch),
    claim: async (id,user) => store.claim(id,user), placeBid: async (id,user,amount) => store.placeBid(id,user,amount),
    approve: async (id,user) => store.approve(id,user), reject: async (id,user) => store.reject(id,user), fulfill: async (id,user) => store.fulfill(id,user),
    dashboard: async user => store.dashboard(user),
  };
  const app = express();
  if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";
  app.use((req, res, next) => {
    if (req.headers.origin === frontend) res.header("Access-Control-Allow-Origin", frontend);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, privy-id-token");
    if (req.method === "OPTIONS") return void res.sendStatus(204);
    next();
  });
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  const mutationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
  const attachUser = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const session = await auth.readSession(req.cookies?.[sessionCookieName] as string | undefined);
      if (session) { req.authSession = session; req.user = session.user; return next(); }
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (token) {
        const identity = await verifyToken(token);
        req.user = { id: identity.did, did: identity.did, handle: identity.handle, name: identity.name, avatar: identity.avatar };
      }
      next();
    } catch { next(); }
  };
  const requireUser = (req: Request, res: Response, next: NextFunction) => req.user ? next() : void res.status(401).json({ error: "log in with X" });
  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    if (!req.authSession || !csrfMatches(req.authSession, req.get("x-csrf-token"))) return void res.status(403).json({ error: "invalid CSRF token" });
    next();
  };

  app.get("/health", (_req, res) => res.json({ status: "ok", auth: privyConfigured ? "privy" : "unconfigured", sessions: "postgres" }));
  app.post("/api/auth/session", authLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return void res.status(401).json({ error: "missing access token" });
    const identityToken = (typeof req.headers["privy-id-token"] === "string" ? req.headers["privy-id-token"] : undefined) || (req.body as { identityToken?: string } | null)?.identityToken;
    try {
      const created = await auth.createSession(await verifyToken(token, identityToken));
      res.cookie(sessionCookieName, created.token, cookieOptions());
      res.json({ ...created.session.user, csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt.toISOString() });
    } catch (e) { sendErr(res, e); }
  });
  app.get("/api/auth/me", attachUser, requireUser, (req, res) => {
    if (!req.authSession) return void res.status(401).json({ error: "session required" });
    res.json({ ...req.user!, csrfToken: req.authSession.csrfToken, expiresAt: req.authSession.expiresAt.toISOString() });
  });
  app.post("/api/auth/logout", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    await auth.destroySession(req.cookies?.[sessionCookieName] as string | undefined);
    res.clearCookie(sessionCookieName, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });
  app.get("/api/listings", async (_req, res) => { try { res.json(await repo.summaries()); } catch(e){sendErr(res,e);} });
  app.get("/api/listings/:slug", async (req, res) => { try { const listing = await repo.get(req.params.slug); listing ? res.json(listing) : res.status(404).json({ error: "listing not found" }); } catch(e){sendErr(res,e);} });
  app.get("/api/seller/dashboard", attachUser, requireUser, async (req,res)=>{try{res.json(await repo.dashboard(req.user!.id));}catch(e){sendErr(res,e);}});
  app.post("/api/listings", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateListingRequest>;
    if (!body.title?.trim()) return void res.status(400).json({ error: "title is required" });
    try { res.status(201).json(await repo.create({ ...body, title: body.title }, req.user!)); } catch (e) { sendErr(res, e); }
  });
  app.patch("/api/listings/:slug", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.update(req.params.slug, req.user!.id, req.body as { title?: string; story?: string })); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/claim", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.claim(req.params.id, req.user!)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/bid", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const amount = Number((req.body as { amount?: number } | null)?.amount);
    if (!(amount > 0)) return void res.status(400).json({ error: "positive amount is required" });
    try { res.json(await repo.placeBid(req.params.id, req.user!, amount)); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/approve", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.approve(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/reject", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.reject(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/fulfill", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.fulfill(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  return app;
}

async function start() {
  const pool = createDatabasePool();
  const auth = new PostgresAuthRepository(pool);
  const market = new PostgresMarketplaceRepository(pool);
  await auth.migrate();
  await market.migrate();
  const port = Number(process.env.PORT ?? 8080);
  createApp({ auth, market }).listen(port, () => console.log(`spotboard api listening on :${port} (postgres persistence on)`));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) start().catch((error) => { console.error(error); process.exit(1); });
