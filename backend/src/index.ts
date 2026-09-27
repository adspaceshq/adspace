import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { Store } from "./store.js";
import { cookieOptions, privyConfigured, sessionCookieName, userFromAccessToken } from "./auth.js";
import { csrfMatches, isReviewer, MemoryProfileRepository, type AuthRepository, type ProfileRepository, type StoredSession } from "./db.js";
import type { MarketplaceRepository } from "./market.js";
import { TERMS_TEXT, TERMS_VERSION } from "./types.js";
import type { AuthenticatedIdentity, CreateListingRequest, PurchaseAssets, SessionUser, TermsDoc, UpdateProfileRequest } from "./types.js";
import { adspacesProgramId, type SolanaCluster } from "./config.js";

declare global { namespace Express { interface Request { user?: SessionUser; authSession?: StoredSession } } }

export interface AppDependencies {
  auth: AuthRepository;
  verifyToken?: (token: string, identityToken?: string) => Promise<AuthenticatedIdentity>;
  market?: MarketplaceRepository;
  store?: Store;
  profiles?: ProfileRepository;
  /** X handles or user IDs allowed to review submissions. Defaults to PLATFORM_REVIEWERS. */
  reviewers?: string[];
  frontendUrl?: string;
  trustProxy?: number;
  chain?: { cluster: SolanaCluster; programId: string };
}

const sendErr = (res: Response, e: unknown) => {
  const status = (e as { status?: number }).status ?? 500;
  res.status(status).json({ error: status === 500 ? "internal error" : e instanceof Error ? e.message : "request failed" });
};

/** Buyer brand assets ride the claim/bid body; the repo validates them. */
const purchaseAssets = (body: unknown): PurchaseAssets => {
  const b = (body ?? {}) as Partial<PurchaseAssets>;
  return {
    ...(typeof b.website === "string" ? { website: b.website } : {}),
    ...(typeof b.logoUrl === "string" ? { logoUrl: b.logoUrl } : {}),
  };
};

export function createApp({
  auth,
  verifyToken = userFromAccessToken,
  market,
  store = new Store(),
  profiles = new MemoryProfileRepository(),
  reviewers = (process.env.PLATFORM_REVIEWERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000",
  trustProxy = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : undefined,
  chain = { cluster: "devnet", programId: adspacesProgramId },
}: AppDependencies) {
  const repo: MarketplaceRepository = market ?? {
    migrate: () => store.migrate(), summaries: async () => store.summaries(), get: async slug => store.get(slug),
    create: async (body, seller) => store.createForUser(body, seller), update: async (slug,user,patch) => store.update(slug,user,patch),
    claim: async (id,user,assets) => store.claim(id,user,assets), placeBid: async (id,user,amount,assets) => store.placeBid(id,user,amount,assets),
    close: async (slug,user) => store.close(slug,user), reopen: async (slug,user) => store.reopen(slug,user), remove: async (slug,user) => store.remove(slug,user),
    approve: async (id,user) => store.approve(id,user), reject: async (id,user) => store.reject(id,user), fulfill: async (id,user) => store.fulfill(id,user),
    dashboard: async user => store.dashboard(user),
    reviewQueue: async () => store.reviewQueue(), approveReview: async slug => store.approveReview(slug),
    rejectReview: async (slug,reason) => store.rejectReview(slug,reason),
    acceptTerms: async (slug,user,version) => store.acceptTerms(slug,user,version),
  };
  const app = express();
  if (trustProxy !== undefined) app.set("trust proxy", trustProxy);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "4mb" }));
  app.use(cookieParser());
  app.use((req, res, next) => {
    if (req.headers.origin === frontendUrl) res.header("Access-Control-Allow-Origin", frontendUrl);
    res.header("Vary", "Origin");
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
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
    // No session cookie (e.g. expired) but a valid Privy Bearer: the client
    // must exchange for a fresh session — a CSRF retry can never succeed.
    if (!req.authSession) return void res.status(401).json({ error: "session required — log out and log in again" });
    if (!csrfMatches(req.authSession, req.get("x-csrf-token"))) return void res.status(403).json({ error: "invalid CSRF token" });
    next();
  };
  const requireReviewer = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !isReviewer(req.user, reviewers)) return void res.status(403).json({ error: "reviewer access required" });
    next();
  };

  app.get("/health", (_req, res) => res.json({
    status: "ok",
    auth: privyConfigured ? "privy" : "unconfigured",
    sessions: "postgres",
    chain: { cluster: chain.cluster, programId: chain.programId, integration: "pending-idl" },
  }));
  app.post("/api/auth/session", authLimiter, async (req, res) => {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return void res.status(401).json({ error: "missing access token" });
    const identityToken = (typeof req.headers["privy-id-token"] === "string" ? req.headers["privy-id-token"] : undefined) || (req.body as { identityToken?: string } | null)?.identityToken;
    try {
      const created = await auth.createSession(await verifyToken(token, identityToken));
      // Step 1: every login owns a profile row, even with zero listings.
      try { await profiles.upsertFromSession(created.session.user); } catch (e) { console.warn("profile upsert:", e instanceof Error ? e.message : e); }
      res.cookie(sessionCookieName, created.token, cookieOptions());
      res.json({ ...created.session.user, csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt.toISOString(), isReviewer: isReviewer(created.session.user, reviewers) });
    } catch (e) { sendErr(res, e); }
  });
  app.get("/api/auth/me", attachUser, requireUser, (req, res) => {
    if (!req.authSession) return void res.status(401).json({ error: "session required" });
    res.json({ ...req.user!, csrfToken: req.authSession.csrfToken, expiresAt: req.authSession.expiresAt.toISOString(), isReviewer: isReviewer(req.user!, reviewers) });
  });
  app.post("/api/auth/logout", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    await auth.destroySession(req.cookies?.[sessionCookieName] as string | undefined);
    res.clearCookie(sessionCookieName, { ...cookieOptions(), maxAge: undefined });
    res.json({ ok: true });
  });
  app.get("/api/users/:handle", attachUser, async (req, res) => {
    try {
      const profile = await profiles.getProfileByHandle(req.params.handle);
      if (!profile) return void res.status(404).json({ error: "profile not found" });
      // payoutWallet is owner-only; everyone else gets the public shape.
      if (!req.user || req.user.id !== profile.id) {
        const { payoutWallet: _stripped, ...pub } = profile;
        return void res.json(pub);
      }
      res.json(profile);
    } catch (e) { sendErr(res, e); }
  });
  app.patch("/api/users/me", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Partial<UpdateProfileRequest>;
    const patch: UpdateProfileRequest = {
      ...(typeof body.bio === "string" ? { bio: body.bio } : {}),
      ...(typeof body.payoutWallet === "string" ? { payoutWallet: body.payoutWallet } : {}),
    };
    try { res.json(await profiles.updateProfile(req.user!.id, patch)); } catch (e) { sendErr(res, e); }
  });
  app.get("/api/review/queue", attachUser, requireUser, requireReviewer, async (_req, res) => {
    try { res.json(await repo.reviewQueue()); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/listings/:slug/approve", mutationLimiter, attachUser, requireUser, requireCsrf, requireReviewer, async (req, res) => {
    try { res.json(await repo.approveReview(req.params.slug)); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/listings/:slug/reject", mutationLimiter, attachUser, requireUser, requireCsrf, requireReviewer, async (req, res) => {
    const reason = (req.body as { reason?: unknown } | null)?.reason;
    try { res.json(await repo.rejectReview(req.params.slug, typeof reason === "string" ? reason : "")); } catch (e) { sendErr(res, e); }
  });
  app.get("/api/terms", (_req, res) => {
    res.json({ version: TERMS_VERSION, text: TERMS_TEXT } satisfies TermsDoc);
  });
  app.post("/api/listings/:slug/accept-terms", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const version = (req.body as { version?: unknown } | null)?.version;
    try { res.json(await repo.acceptTerms(req.params.slug, req.user!.id, typeof version === "string" ? version : "")); } catch (e) { sendErr(res, e); }
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
  app.post("/api/listings/:slug/close", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.close(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/listings/:slug/reopen", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.reopen(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.delete("/api/listings/:slug", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.remove(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/claim", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.claim(req.params.id, req.user!, purchaseAssets(req.body))); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/bid", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const amount = Number((req.body as { amount?: number } | null)?.amount);
    if (!(amount > 0)) return void res.status(400).json({ error: "positive amount is required" });
    try { res.json(await repo.placeBid(req.params.id, req.user!, amount, purchaseAssets(req.body))); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/approve", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.approve(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/reject", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.reject(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/fulfill", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.fulfill(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  return app;
}
