import express, { type NextFunction, type Request, type Response, type Router } from "express";
import cookieParser from "cookie-parser";
import { rateLimit } from "express-rate-limit";
import { Store } from "./store.js";
import { cookieOptions, privyConfigured, sessionCookieName, userFromAccessToken } from "./auth.js";
import { csrfMatches, isReviewer, MemoryProfileRepository, type AuthRepository, type ProfileRepository, type StoredSession } from "./db.js";
import type { MarketplaceRepository } from "./market.js";
import { TERMS_TEXT, TERMS_VERSION } from "./types.js";
import type { AuthenticatedIdentity, CreateListingRequest, PurchaseAssets, SessionUser, TermsDoc, UpdateProfileRequest } from "./types.js";
import { adspacesProgramId, type SolanaCluster } from "./config.js";
import { MemoryWithdrawalRepository, type WithdrawalRepository } from "./withdrawals.js";
import type { WalletWithdrawal } from "./withdrawals.js";
import type { ListingPublisher } from "./listing-chain.js";
import type { ReviewPolicy } from "./adspaces-program.js";
import type { FixedClaimExecutor } from "./fixed-claim-chain.js";
import type { AuctionBidExecutor } from "./auction-bid-chain.js";
import type { ProofChainExecutor } from "./proof-chain.js";
import type { SettlementExecutor } from "./settlement-chain.js";
import type { DisputeChainExecutor } from "./dispute-chain.js";
import type { DisputeResolutionExecutor } from "./dispute-resolution-chain.js";
import type { RefundChainExecutor } from "./refund-chain.js";
import type { CloseSpotsChainExecutor } from "./close-spots-chain.js";
import type { ChainReconciler } from "./chain-reconciliation.js";
import { isHostedAssetUrl, signedUploadPayload } from "./cloudinary.js";

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
  withdrawals?: WithdrawalRepository;
  withdrawalSponsor?: { send(user: SessionUser, withdrawal: WalletWithdrawal): Promise<string> };
  sellerIdentities?: { get(userId: string): Promise<SessionUser | undefined> };
  listingPublisher?: ListingPublisher;
  fixedClaimExecutor?: FixedClaimExecutor;
  auctionBidExecutor?: AuctionBidExecutor;
  proofChainExecutor?: ProofChainExecutor;
  settlementExecutor?: SettlementExecutor;
  disputeChainExecutor?: DisputeChainExecutor;
  disputeResolutionExecutor?: DisputeResolutionExecutor;
  refundChainExecutor?: RefundChainExecutor;
  closeSpotsChainExecutor?: CloseSpotsChainExecutor;
  chainReconciler?: ChainReconciler;
  /** Rebuilt API on the app schema; mounted at /api/v2 alongside the legacy routes. */
  v2Router?: Router;
}

const sendErr = (res: Response, e: unknown) => {
  const status = (e as { status?: number }).status ?? 500;
  if (status === 500) console.error(e instanceof Error ? e.stack ?? e.message : String(e));
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

const validUploadedImage = (url: string | undefined) => Boolean(url && (url.startsWith("data:image/") || isHostedAssetUrl(url)));

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
  withdrawals = new MemoryWithdrawalRepository(),
  withdrawalSponsor,
  sellerIdentities,
  listingPublisher,
  fixedClaimExecutor,
  auctionBidExecutor,
  proofChainExecutor,
  settlementExecutor,
  disputeChainExecutor,
  disputeResolutionExecutor,
  refundChainExecutor,
  closeSpotsChainExecutor,
  chainReconciler,
  v2Router,
}: AppDependencies) {
  const repo: MarketplaceRepository = market ?? {
    migrate: () => store.migrate(), summaries: async () => store.summaries(), get: async slug => store.get(slug),
    create: async (body, seller) => store.createForUser(body, seller), update: async (slug,user,patch) => store.update(slug,user,patch),
    claim: async (id,user,assets) => store.claim(id,user,assets), placeBid: async (id,user,amount,assets) => store.placeBid(id,user,amount,assets),
    close: async (slug,user) => store.close(slug,user), reopen: async (slug,user) => store.reopen(slug,user), remove: async (slug,user) => store.remove(slug,user),
    approve: async (id,user) => store.approve(id,user), reject: async (id,user) => store.reject(id,user), fulfill: async (id,user) => store.fulfill(id,user),
    dashboard: async user => store.dashboard(user),
    buyerSpots: async user => store.buyerSpots(user),
    reviewQueue: async () => store.reviewQueue(), approveReview: async (slug, policy) => store.approveReview(slug, policy),
    recordChainPublication: async (slug, publication) => { store.recordChainPublication(slug, publication); },
    rejectReview: async (slug,reason) => store.rejectReview(slug,reason),
    acceptTerms: async (slug,user,version) => store.acceptTerms(slug,user,version),
    submitArtwork: async (id,user,assets) => store.submitArtwork(id,user,assets),
    submitProof: async (id,user,proof) => store.submitProof(id,user,proof),
    confirmSpot: async (id,user) => store.confirmSpot(id,user),
    disputeSpot: async (id,user,reason) => store.disputeSpot(id,user,reason),
    withdrawDispute: async (id,user) => store.withdrawDispute(id,user),
    resolveDispute: async (id,reference) => store.resolveDispute(id,reference),
    recordRefund: async (id,reference) => store.recordRefund(id,reference),
    payableQueue: async () => store.payableQueue(),
    disputeQueue: async () => store.disputeQueue(),
    paySpot: async (id,reference) => store.paySpot(id,reference),
  };
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
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });
  const mutationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
  const attachUser = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const session = await auth.readSession(req.cookies?.[sessionCookieName] as string | undefined);
      if (session) { req.authSession = session; req.user = session.user; return next(); }
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (token) {
        const identityToken = typeof req.headers["privy-id-token"] === "string" ? req.headers["privy-id-token"] : undefined;
        const created = await auth.createSession(await verifyToken(token, identityToken));
        try { await profiles.upsertFromSession(created.session.user); } catch (e) { console.warn("profile upsert:", e instanceof Error ? e.message : e); }
        res.cookie(sessionCookieName, created.token, cookieOptions());
        req.authSession = created.session;
        req.user = created.session.user;
      }
      next();
    } catch { next(); }
  };
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return void res.status(401).json({ error: "log in required" });
    if (req.user.hasX === false) return void res.status(403).json({ error: "connect X to complete your Adspaces account" });
    next();
  };
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

  if (v2Router) app.use("/api/v2", v2Router);

  app.get("/health", (_req, res) => res.json({
    status: "ok",
    auth: privyConfigured ? "privy" : "unconfigured",
    sessions: "postgres",
    chain: { cluster: chain.cluster, programId: chain.programId, integration: listingPublisher ? "accept-terms" : "disabled" },
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
      const onboarding = await profiles.getOnboarding(created.session.user.id).catch(() => null);
      res.json({ ...created.session.user, csrfToken: created.session.csrfToken, expiresAt: created.session.expiresAt.toISOString(), isReviewer: isReviewer(created.session.user, reviewers), onboarding });
    } catch (e) { sendErr(res, e); }
  });
  app.get("/api/auth/me", attachUser, requireUser, async (req, res) => {
    if (!req.authSession) return void res.status(401).json({ error: "session required" });
    const onboarding = await profiles.getOnboarding(req.user!.id).catch(() => null);
    res.json({ ...req.user!, csrfToken: req.authSession.csrfToken, expiresAt: req.authSession.expiresAt.toISOString(), isReviewer: isReviewer(req.user!, reviewers), onboarding });
  });
  app.put("/api/users/me/onboarding", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try { res.json(await profiles.saveOnboarding(req.user!.id, req.body)); } catch (e) { sendErr(res, e); }
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
  app.post("/api/uploads/sign", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try { res.json(signedUploadPayload((req.body as { kind?: unknown } | null)?.kind)); } catch (e) { sendErr(res, e); }
  });
  app.get("/api/wallet/withdrawals", attachUser, requireUser, async (req, res) => {
    try { res.json(await withdrawals.list(req.user!.id)); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/wallet/withdrawals", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as { destination?: unknown; amount?: unknown };
    if (!req.user!.walletAddress) return void res.status(409).json({ error: "embedded wallet is not ready" });
    try {
      res.status(201).json(await withdrawals.create(
        req.user!.id,
        req.user!.walletAddress,
        typeof body.destination === "string" ? body.destination.trim() : "",
        Number(body.amount),
      ));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/wallet/withdrawals/:id/confirm", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const signature = (req.body as { signature?: unknown } | null)?.signature;
    try { res.json(await withdrawals.confirm(req.params.id, req.user!.id, typeof signature === "string" ? signature : "")); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/wallet/withdrawals/:id/execute", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    if (!withdrawalSponsor) return void res.status(503).json({ error: "withdrawal sponsorship is unavailable" });
    try {
      const withdrawal = await withdrawals.get(req.params.id, req.user!.id);
      if (withdrawal.status !== "pending") return void res.status(409).json({ error: "withdrawal is not pending" });
      const signature = await withdrawalSponsor.send(req.user!, withdrawal);
      res.json(await withdrawals.confirm(withdrawal.id, req.user!.id, signature));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/wallet/withdrawals/:id/fail", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try { res.json(await withdrawals.fail(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); }
  });
  app.get("/api/review/queue", attachUser, requireUser, requireReviewer, async (_req, res) => {
    try { res.json(await repo.reviewQueue()); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/listings/:slug/approve", mutationLimiter, attachUser, requireUser, requireCsrf, requireReviewer, async (req, res) => {
    try {
      const listing = await repo.get(req.params.slug);
      if (!listing) return void res.status(404).json({ error: "listing not found" });
      if (listing.status !== "submitted") return void res.status(409).json({ error: "listing is not awaiting review" });
      const body = (req.body ?? {}) as Partial<ReviewPolicy>;
      const artworkClose = new Date(listing.artworkClose || listing.deadline).getTime();
      const policy: ReviewPolicy = {
        feeBps: Number(body.feeBps ?? 250),
        upliftFeeBps: Number(body.upliftFeeBps ?? (listing.mode === "auction" ? 250 : 0)),
        maxFeeBps: Number(body.maxFeeBps ?? 250),
        reviewWindowSeconds: Number(body.reviewWindowSeconds ?? 172800),
        deliveryDeadline: typeof body.deliveryDeadline === "string" && body.deliveryDeadline
          ? body.deliveryDeadline
          : new Date(artworkClose + 7 * 86_400_000).toISOString(),
      };
      res.json(await repo.approveReview(req.params.slug, policy));
    } catch (e) { sendErr(res, e); }
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
    try {
      const listing = await repo.get(req.params.slug);
      if (!listing) return void res.status(404).json({ error: "listing not found" });
      if (listing.status === "approved" && listingPublisher && version === TERMS_VERSION && listing.sellerUserId === req.user!.id) {
        const policy: ReviewPolicy = { feeBps:listing.feeBps ?? 250, upliftFeeBps:listing.upliftFeeBps ?? 0, maxFeeBps:listing.maxFeeBps ?? 250, reviewWindowSeconds:listing.reviewWindowSeconds ?? 172800, deliveryDeadline:listing.deliveryDeadline ?? new Date(Date.now()+7*86400000).toISOString() };
        const publication = await listingPublisher.publish(listing, req.user!, policy);
        if (publication) await repo.recordChainPublication(req.params.slug, publication);
      }
      res.json(await repo.acceptTerms(req.params.slug, req.user!.id, typeof version === "string" ? version : ""));
    } catch (e) { sendErr(res, e); }
  });
  app.get("/api/listings", async (_req, res) => { try { res.json(await repo.summaries()); } catch(e){sendErr(res,e);} });
  app.get("/api/listings/:slug", async (req, res) => { try { const listing = await repo.get(req.params.slug); listing ? res.json(listing) : res.status(404).json({ error: "listing not found" }); } catch(e){sendErr(res,e);} });
  app.get("/api/seller/dashboard", attachUser, requireUser, async (req,res)=>{try{res.json(await repo.dashboard(req.user!.id));}catch(e){sendErr(res,e);}});
  app.get("/api/sponsor/dashboard", attachUser, requireUser, async (req,res)=>{try{res.json(await repo.buyerSpots(req.user!));}catch(e){sendErr(res,e);}});
  app.post("/api/listings", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Partial<CreateListingRequest>;
    if (!body.title?.trim()) return void res.status(400).json({ error: "title is required" });
    try { res.status(201).json(await repo.create({ ...body, title: body.title }, req.user!)); } catch (e) { sendErr(res, e); }
  });
  app.patch("/api/listings/:slug", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.update(req.params.slug, req.user!.id, req.body as { title?: string; story?: string })); } catch (e) { sendErr(res, e); } });
  app.post("/api/listings/:slug/close", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { if(closeSpotsChainExecutor)await closeSpotsChainExecutor.close(req.params.slug,req.user!);res.json(await repo.close(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/listings/:slug/reopen", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.reopen(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.delete("/api/listings/:slug", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { if(closeSpotsChainExecutor)await closeSpotsChainExecutor.close(req.params.slug,req.user!);res.json(await repo.remove(req.params.slug, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/claim", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const assets = purchaseAssets(req.body);
    try {
      if (fixedClaimExecutor) {
        if (!validUploadedImage(assets.logoUrl) || assets.logoUrl!.length > 3_000_000) {
          return void res.status(400).json({ error: "a valid logo is required" });
        }
        if (assets.website && !/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(assets.website)) {
          return void res.status(400).json({ error: "website must be an http(s) URL" });
        }
        await fixedClaimExecutor.claim(req.params.id, req.user!);
      }
      res.json(await repo.claim(req.params.id, req.user!, assets));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/bid", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const amount = Number((req.body as { amount?: number } | null)?.amount);
    if (!(amount > 0)) return void res.status(400).json({ error: "positive amount is required" });
    const assets = purchaseAssets(req.body);
    try {
      if (auctionBidExecutor) {
        if (!validUploadedImage(assets.logoUrl) || assets.logoUrl!.length > 3_000_000) {
          return void res.status(400).json({ error: "a valid logo is required" });
        }
        await auctionBidExecutor.bid(req.params.id, req.user!, amount);
      }
      res.json(await repo.placeBid(req.params.id, req.user!, amount, assets));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/artwork", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try { res.json(await repo.submitArtwork(req.params.id, req.user!, purchaseAssets(req.body))); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/proof", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as { photos?: unknown; postUrl?: unknown };
    try {
      if (proofChainExecutor) await proofChainExecutor.submit(req.params.id, req.user!, { photos: body.photos, postUrl: body.postUrl });
      res.json(await repo.submitProof(req.params.id, req.user!.id, { photos: body.photos, postUrl: body.postUrl }));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/confirm", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try { res.json(await repo.confirmSpot(req.params.id, req.user!)); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/dispute", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    const reason = (req.body as { reason?: unknown } | null)?.reason;
    try {
      const cleanReason=typeof reason === "string" ? reason.trim() : "";
      if(disputeChainExecutor && cleanReason) await disputeChainExecutor.raise(req.params.id,req.user!,cleanReason);
      res.json(await repo.disputeSpot(req.params.id, req.user!, cleanReason));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/withdraw", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => {
    try {
      if(disputeChainExecutor) await disputeChainExecutor.withdraw(req.params.id,req.user!);
      res.json(await repo.withdrawDispute(req.params.id, req.user!));
    } catch (e) { sendErr(res, e); }
  });
  app.get("/api/review/payable", attachUser, requireUser, requireReviewer, async (_req, res) => {
    try { res.json(await repo.payableQueue()); } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/pay", mutationLimiter, attachUser, requireUser, requireCsrf, requireReviewer, async (req, res) => {
    const reference = (req.body as { reference?: unknown } | null)?.reference;
    try {
      const signature = settlementExecutor ? await settlementExecutor.settle(req.params.id) : typeof reference === "string" ? reference : "";
      res.json(await repo.paySpot(req.params.id, signature));
    } catch (e) { sendErr(res, e); }
  });
  app.post("/api/spots/:id/refund",mutationLimiter,attachUser,requireUser,requireCsrf,async(req,res)=>{try{if(!refundChainExecutor)return void res.status(503).json({error:"on-chain refunds are unavailable"});const signature=await refundChainExecutor.refund(req.params.id,req.user!);res.json(await repo.recordRefund(req.params.id,signature));}catch(e){sendErr(res,e);}});
  app.get("/api/review/disputes",attachUser,requireUser,requireReviewer,async(_req,res)=>{try{res.json(await repo.disputeQueue());}catch(e){sendErr(res,e);}});
  app.post("/api/review/reconcile",mutationLimiter,attachUser,requireUser,requireCsrf,requireReviewer,async(_req,res)=>{try{if(!chainReconciler)return void res.status(503).json({error:"chain reconciliation is unavailable"});res.json(await chainReconciler.reconcile())}catch(e){sendErr(res,e)}});
  app.post("/api/spots/:id/resolve", mutationLimiter, attachUser, requireUser, requireCsrf, requireReviewer, async(req,res)=>{try{if(!disputeResolutionExecutor)return void res.status(503).json({error:"dispute resolution is unavailable"});const body=(req.body??{}) as {sellerShareBps?:unknown;decision?:unknown};const signature=await disputeResolutionExecutor.resolve(req.params.id,Number(body.sellerShareBps),typeof body.decision==="string"?body.decision:"");res.json(await repo.resolveDispute(req.params.id,signature));}catch(e){sendErr(res,e);}});
  app.post("/api/spots/:id/approve", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.approve(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/reject", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.reject(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  app.post("/api/spots/:id/fulfill", mutationLimiter, attachUser, requireUser, requireCsrf, async (req, res) => { try { res.json(await repo.fulfill(req.params.id, req.user!.id)); } catch (e) { sendErr(res, e); } });
  return app;
}
