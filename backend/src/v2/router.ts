import { sql } from "drizzle-orm";
import { PublicKey } from "@solana/web3.js";
import { hasRole, invalidRoleEntries } from "./roles.js";
import { grantStaffRole, listStaff, revokeStaffRole, staffRoleOf, type StaffRole } from "../services/staff.js";
import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { cookieOptions, userFromAccessToken } from "../auth.js";
import { csrfMatches, type StoredSession } from "../db.js";
import type { Db } from "../db/client.js";
import { AppAuthRepository, parseHandle } from "../repositories/app-auth.js";
import {
  acceptTermsAndPublish,
  createDraft,
  reviewListing,
  submitForReview,
  updateDraft,
  deleteDraft,
  type DraftInput,
  type ReviewDecision,
} from "../services/listing-lifecycle.js";
import { getOwnedListing, getPublishedListing, listForSeller, listPublished, parseBrowseFilters, reviewListingDetail, reviewQueue, getSponsoredSpot } from "../services/listing-queries.js";
import { parseAssetKind, registerMedia, signUpload } from "../services/media.js";
import { claimSpot, placeBid } from "../services/spot-purchase.js";
import { assertCurrentTerms } from "../services/terms.js";
import { createPost, deletePost, listPosts, recordMetrics } from "../services/listing-posts.js";
import { listMessages, postMessage } from "../services/spot-messages.js";
import { submitSpotProof } from "../services/spot-proof.js";
import { payoutSeller } from "../services/settlement.js";
import { raiseDispute, resolveDispute, timeoutDispute, withdrawDispute, type DisputeDeps } from "../services/disputes.js";
import { closeListing, closeSpot, refundSpot, rentReport, type RefundDeps } from "../services/refunds.js";
import { listWithdrawals, prepareWithdrawal, submitWithdrawal } from "../services/wallet.js";
import { publicProfilePage } from "../services/profiles.js";
import { spotBidHistory } from "../services/bid-history.js";
import { listingLedger, searchListings, verifyLedger } from "../services/ledger.js";
import { listWatchlist, unwatchListing, watchListing } from "../services/watchlist.js";
import { getPrefs, listNotifications, markRead, setPrefs } from "../services/notifications.js";
import { reconcile } from "../services/reconciler.js";
import { adoptListings, prepareGuardianPause, setDisputeTimeout, setPaused, submitGuardianPause, type AdminDeps, type GuardianPauseDeps } from "../services/admin.js";
import { adminMetrics, readChainMetrics } from "../services/metrics.js";
import { closeTicket, createTicket, getTicket, listMyTickets, listTickets, openTicketCount, replyToTicket, type SupportState } from "../services/support.js";
import { activityFeed, creatorDashboard, creatorEarnings, reviewSummary, spotDetail, spotTimeline, sponsorDashboard } from "../services/dashboards.js";
import type { ChainContext } from "./chain-context.js";

// Separate from the legacy cookie: v2 sessions live in the app schema.
const SESSION_COOKIE = "adspaces_v2_session";

declare module "express-serve-static-core" {
  interface Request {
    v2Session?: StoredSession;
  }
}

class BadRequest extends Error {
  readonly status = 400;
}

// bigint money values serialise as decimal strings of USDC base units.
function send(res: Response, body: unknown, status = 200) {
  res
    .status(status)
    .type("application/json")
    .send(JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? value.toString() : value)));
}

function sendError(res: Response, error: unknown) {
  const status = (error as { status?: number }).status;
  if (status && status >= 400 && status < 600) return send(res, { error: (error as Error).message }, status);
  // Message and stack only: SDK errors can carry request details such as headers.
  console.error("v2 api:", error instanceof Error ? error.stack ?? error.message : String(error));
  send(res, { error: "something went wrong" }, 500);
}

const handle =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response): void => {
    fn(req, res).catch((error) => sendError(res, error));
  };

// Accepts "50", "50.25" (USDC) and returns base units; rejects more than 6 decimals.
export function parseUsdc(value: unknown, field: string): bigint {
  const text = typeof value === "number" ? value.toString() : typeof value === "string" ? value.trim() : "";
  const match = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) throw new BadRequest(`${field} must be a USDC amount with at most 6 decimals`);
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}

function parseDate(value: unknown, field: string, optional = false): Date | undefined {
  if (value === undefined && optional) return undefined;
  const date = typeof value === "string" ? new Date(value) : undefined;
  if (!date || Number.isNaN(date.getTime())) throw new BadRequest(`${field} must be an ISO date`);
  return date;
}

function parseDraft(body: Record<string, unknown>): DraftInput {
  const spots = Array.isArray(body.spots) ? body.spots : [];
  return {
    surface: body.surface as DraftInput["surface"],
    title: typeof body.title === "string" ? body.title : "",
    description: typeof body.description === "string" ? body.description : undefined,
    audience: (body.audience as DraftInput["audience"]) ?? undefined,
    mode: body.mode === "auction" ? "auction" : "fixed",
    deadline: parseDate(body.deadline, "deadline")!,
    artworkDueAt: parseDate(body.artworkDueAt, "artworkDueAt", true),
    deliveryDueAt: parseDate(body.deliveryDueAt, "deliveryDueAt", true),
    minIncrement: body.minIncrement === undefined ? undefined : parseUsdc(body.minIncrement, "minIncrement"),
    doubleUp: body.doubleUp === true,
    photoAssetIds: Array.isArray(body.photoAssetIds) ? body.photoAssetIds.filter((id): id is string => typeof id === "string") : undefined,
    spots: spots.map((spot, index) => {
      const item = (spot ?? {}) as Record<string, unknown>;
      const layout = (item.layout ?? {}) as DraftInput["spots"][number]["layout"];
      if (![layout.x, layout.y, layout.w].every((n) => typeof n === "number" && Number.isFinite(n))) {
        throw new BadRequest(`spot ${index + 1} needs a position`);
      }
      return { label: typeof item.label === "string" ? item.label : undefined, price: parseUsdc(item.price, `spot ${index + 1} price`), layout };
    }),
  };
}

function parseDecision(body: Record<string, unknown>): ReviewDecision {
  const note = typeof body.note === "string" ? body.note : "";
  if (body.action === "approve") {
    const fees = (body.fees ?? {}) as Record<string, unknown>;
    return {
      action: "approve",
      fees: { feeBps: Number(fees.feeBps), upliftFeeBps: Number(fees.upliftFeeBps ?? 0), maxFeeBps: Number(fees.maxFeeBps) },
      reviewWindowSeconds: body.reviewWindowSeconds === undefined ? undefined : Number(body.reviewWindowSeconds),
      deliveryDueAt: parseDate(body.deliveryDueAt, "deliveryDueAt", true),
      note,
    };
  }
  if (body.action === "request_changes" || body.action === "reject") return { action: body.action, note };
  throw new BadRequest("action must be approve, request_changes or reject");
}

export function createV2Router(options: {
  db: Db;
  chain?: ChainContext;
  reviewers: readonly string[];
  // Can pause the protocol and change protocol settings. Entries are user ids or Privy DIDs, never handles.
  admins?: readonly string[];
  termsVersion: string;
  metadataBaseUrl: string;
  withdrawalDailyLimit?: bigint;
  // Reported by the public status endpoint so the app can label test money.
  cluster?: string;
  // How long the public status endpoint reuses the on-chain pause flag.
  statusCacheMs?: number;
  // Lets a buyer pay a dispute's rent from their own wallet when the platform can't co-sign.
  buyerPaidDisputes?: boolean;
  // Below this the metrics page flags the fee and rent payer as low (MIN_FEE_PAYER_LAMPORTS).
  minFeePayerLamports?: number;
}) {
  const { db, chain, reviewers } = options;
  const minFeePayerLamports = options.minFeePayerLamports ?? 1_000_000_000;
  const badRoles = invalidRoleEntries([...reviewers, ...(options.admins ?? [])]);
  if (badRoles.length) console.warn(`PLATFORM_REVIEWERS/PLATFORM_ADMINS entries must be user ids or Privy DIDs; ignoring: ${badRoles.join(", ")}`);
  const auth = new AppAuthRepository(db);
  const router = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
  const mutationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });
  // Per account, on top of the per-IP limit: one account can't spam money actions or burn upload quota.
  const perUser = (windowMs: number, limit: number) =>
    rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, keyGenerator: (req) => `user:${(req as Request).v2Session?.user.id}` });
  const uploadLimiter = perUser(10 * 60_000, 30);
  const moneyLimiter = perUser(60_000, 10);

  const requireChain = (): ChainContext => {
    if (!chain) throw Object.assign(new Error("on-chain actions are not configured"), { status: 503 });
    return chain;
  };

  const admins = options.admins ?? [];
  // Owner admins (env, by id) first, then roles granted in the app (staff table), then env reviewers.
  const roleOf = async (user: { id: string; did: string }): Promise<StaffRole | null> => {
    if (hasRole(user, admins)) return "admin";
    return (await staffRoleOf(db, user.id)) ?? (hasRole(user, reviewers) ? "reviewer" : null);
  };
  const attach = async (req: Request, res: Response, next: NextFunction) => {
    try {
      req.v2Session = await auth.readSession(req.cookies?.[SESSION_COOKIE] as string | undefined);
      res.locals.role = req.v2Session ? await roleOf(req.v2Session.user) : null;
    } catch (error) {
      console.warn("v2 session:", error instanceof Error ? error.message : error);
    }
    next();
  };
  const roleIn = (res: Response) => res.locals.role as StaffRole | null | undefined;
  const requireUser = (req: Request, res: Response, next: NextFunction) => {
    if (!req.v2Session) return void send(res, { error: "sign in required" }, 401);
    next();
  };
  const requireCsrf = (req: Request, res: Response, next: NextFunction) => {
    if (!req.v2Session || !csrfMatches(req.v2Session, req.get("x-csrf-token"))) {
      return void send(res, { error: "invalid CSRF token" }, 403);
    }
    next();
  };
  // Admins can do everything reviewers can, matching the frontend's reviewer gate.
  const requireReviewer = (req: Request, res: Response, next: NextFunction) => {
    if (!req.v2Session || !roleIn(res)) return void send(res, { error: "reviewers only" }, 403);
    next();
  };
  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    if (!req.v2Session || roleIn(res) !== "admin") return void send(res, { error: "admins only" }, 403);
    next();
  };
  const me = (req: Request) => req.v2Session!.user;
  const mutate = [mutationLimiter, requireUser, requireCsrf];

  // Readiness: unlike /health, this checks the database and the RPC node. 503 when either is down.
  router.get("/health", async (_req, res) => {
    const within = <T,>(promise: Promise<T>) =>
      Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out")), 5_000))]);
    const result = async (check: () => Promise<unknown>) => within(check()).then(() => "ok", (error: Error) => error.message);
    const database = await result(() => db.execute(sql`select 1`));
    const rpc = chain ? await result(() => chain.connection.getSlot("confirmed")) : "not configured";
    const ok = database === "ok" && (rpc === "ok" || rpc === "not configured");
    res.status(ok ? 200 : 503).json({ status: ok ? "ok" : "degraded", database, rpc });
  });

  // Public protocol status: whether trading is paused (read from the on-chain config), the cluster and
  // the current terms version. The pause flag is cached briefly so page loads don't each hit the RPC.
  const statusCacheMs = options.statusCacheMs ?? 20_000;
  let pausedCache: { paused: boolean; at: number } | undefined;
  const readPaused = async (): Promise<boolean> => {
    if (!chain) return false;
    if (pausedCache && Date.now() - pausedCache.at < statusCacheMs) return pausedCache.paused;
    try {
      const { paused } = await chain.readProtocolStatus();
      pausedCache = { paused, at: Date.now() };
      return paused;
    } catch (error) {
      // Serve the last known value while the RPC is down rather than flipping the banner.
      if (pausedCache) return pausedCache.paused;
      throw Object.assign(new Error("status is unavailable right now"), { status: 503, cause: error });
    }
  };
  router.get(
    "/status",
    handle(async (_req, res) => {
      const paused = await readPaused();
      res.setHeader("Cache-Control", `public, max-age=${Math.floor(statusCacheMs / 1000)}`);
      send(res, { paused, cluster: options.cluster ?? "devnet", termsVersion: options.termsVersion });
    }),
  );

  router.use(attach);

  // ---------- auth & profile ----------

  const sessionBody = async (session: StoredSession) => {
    const role = await roleOf(session.user);
    return {
      ...session.user,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
      isReviewer: role !== null,
      isAdmin: role === "admin",
      onboarding: await auth.getOnboarding(session.user.id),
    };
  };

  router.post(
    "/auth/session",
    authLimiter,
    handle(async (req, res) => {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return void send(res, { error: "missing access token" }, 401);
      const identityToken = typeof req.headers["privy-id-token"] === "string" ? req.headers["privy-id-token"] : undefined;
      const created = await auth.createSession(await userFromAccessToken(token, identityToken));
      res.cookie(SESSION_COOKIE, created.token, cookieOptions());
      send(res, await sessionBody(created.session));
    }),
  );
  router.get("/auth/me", requireUser, handle(async (req, res) => send(res, await sessionBody(req.v2Session!))));
  router.post(
    "/auth/logout",
    ...mutate,
    handle(async (req, res) => {
      await auth.destroySession(req.cookies?.[SESSION_COOKIE] as string | undefined);
      res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
      send(res, { ok: true });
    }),
  );
  router.put(
    "/me/onboarding",
    ...mutate,
    handle(async (req, res) => {
      const { termsVersion, ...input } = (req.body ?? {}) as Record<string, unknown>;
      send(res, await auth.saveOnboarding(me(req).id, input, { accepted: termsVersion, current: options.termsVersion }));
    }),
  );
  router.patch("/me", ...mutate, handle(async (req, res) => send(res, await auth.updateProfile(me(req).id, req.body ?? {}))));
  router.get(
    "/handles/:handle/available",
    requireUser,
    handle(async (req, res) => {
      try {
        const clean = parseHandle(req.params.handle);
        send(res, { handle: clean, available: await auth.isHandleAvailable(clean, me(req).id) });
      } catch (error) {
        send(res, { available: false, reason: (error as Error).message });
      }
    }),
  );
  router.get(
    "/listings/:slug/spots/:index/sponsor",
    handle(async (req, res) => {
      const sponsored = await getSponsoredSpot(db, req.params.slug, Number(req.params.index));
      if (!sponsored) return void send(res, { error: "sponsored spot not found" }, 404);
      send(res, sponsored);
    }),
  );
  router.get(
    "/users/:handle/page",
    handle(async (req, res) => {
      const page = await publicProfilePage(db, req.params.handle);
      if (!page) return void send(res, { error: "user not found" }, 404);
      send(res, page);
    }),
  );
  router.get(
    "/users/:handle",
    handle(async (req, res) => {
      const profile = await auth.getProfileByHandle(req.params.handle);
      if (!profile) return void send(res, { error: "user not found" }, 404);
      send(res, profile);
    }),
  );

  // ---------- listings ----------

  router.get("/listings", handle(async (req, res) => send(res, await listPublished(db, parseBrowseFilters(req.query as Record<string, unknown>)))));
  router.get(
    "/listings/:slug",
    handle(async (req, res) => {
      const listing = await getPublishedListing(db, req.params.slug);
      if (!listing) return void send(res, { error: "listing not found" }, 404);
      send(res, listing);
    }),
  );
  router.get("/me/listings", requireUser, handle(async (req, res) => send(res, await listForSeller(db, me(req).id))));
  router.post("/listings", ...mutate, handle(async (req, res) => send(res, await createDraft(db, me(req).id, parseDraft(req.body ?? {})), 201)));
  router.patch("/listings/:id", ...mutate, handle(async (req, res) => send(res, await updateDraft(db, me(req).id, req.params.id, parseDraft(req.body ?? {})))));
  router.delete("/listings/:id", ...mutate, handle(async (req, res) => send(res, await deleteDraft(db, me(req).id, req.params.id))));
  router.get(
    "/me/listings/:id",
    requireUser,
    handle(async (req, res) => {
      const listing = await getOwnedListing(db, me(req).id, req.params.id);
      if (!listing) return void send(res, { error: "listing not found" }, 404);
      send(res, listing);
    }),
  );

  // ---------- media ----------

  router.post("/uploads/sign", ...mutate, uploadLimiter, handle(async (req, res) => send(res, signUpload(parseAssetKind(req.body?.kind)))));
  router.post(
    "/media",
    ...mutate,
    uploadLimiter,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      send(res, await registerMedia(db, me(req).id, parseAssetKind(body.kind), { url: body.url, bytes: body.bytes, width: body.width, height: body.height }), 201);
    }),
  );
  router.post("/listings/:id/submit", ...mutate, handle(async (req, res) => send(res, await submitForReview(db, me(req).id, req.params.id))));
  router.post(
    "/listings/:id/publish",
    ...mutate,
    handle(async (req, res) => {
      const context = requireChain();
      if (await readPaused().catch(() => false)) throw Object.assign(new Error("trading is paused"), { status: 409 });
      const published = await acceptTermsAndPublish(
        {
          db,
          program: context.program,
          mint: context.mint,
          reviewer: context.reviewer,
          rentPayer: context.rentPayer,
          runTx: context.runTx,
          metadataBaseUrl: options.metadataBaseUrl,
          termsVersion: options.termsVersion,
        },
        me(req).id,
        req.params.id,
        await context.userSigner(me(req)),
      );
      send(res, published);
    }),
  );

  // ---------- review ----------

  router.get("/review/queue", requireUser, requireReviewer, handle(async (_req, res) => send(res, await reviewQueue(db))));
  router.get(
    "/review/listings/:id",
    requireUser,
    requireReviewer,
    handle(async (req, res) => {
      const listing = await reviewListingDetail(db, req.params.id);
      if (!listing) return void send(res, { error: "listing not found" }, 404);
      send(res, listing);
    }),
  );
  router.post(
    "/review/listings/:id",
    ...mutate,
    requireReviewer,
    handle(async (req, res) => {
      const floor = await requireChain().configFeeFloorBps();
      send(res, await reviewListing(db, me(req).id, req.params.id, parseDecision(req.body ?? {}), floor, new Date(), { isAdmin: roleIn(res) === "admin" }));
    }),
  );

  // ---------- purchases ----------

  const purchaseDeps = () => {
    const context = requireChain();
    return {
      db,
      program: context.program,
      mint: context.mint,
      feePayer: context.reviewer,
      runTx: context.runTx,
      fetchListingDeadline: context.fetchListingDeadline,
      readTokenBalance: context.readTokenBalance,
    };
  };
  // Checks shared by claim and bid, before any chain work: a verified email (outbid, proof and
  // dispute emails go there), agreement to the current terms, and trading not paused.
  const purchaseGate = async (req: Request): Promise<string> => {
    if (!me(req).emailVerified) throw Object.assign(new Error("verify your email first"), { status: 403 });
    const termsVersion = assertCurrentTerms((req.body ?? {}).termsVersion, options.termsVersion);
    // Best effort: the program refuses paused purchases anyway; this just answers sooner.
    if (await readPaused().catch(() => false)) throw Object.assign(new Error("trading is paused"), { status: 409 });
    return termsVersion;
  };
  router.post(
    "/spots/:id/claim",
    ...mutate,
    moneyLimiter,
    handle(async (req, res) => {
      const termsVersion = await purchaseGate(req);
      const deps = purchaseDeps();
      const signer = await requireChain().userSigner(me(req));
      send(res, await claimSpot(deps, req.params.id, { id: me(req).id, signer, termsVersion }, (req.body ?? {}).brand));
    }),
  );
  router.post(
    "/spots/:id/bid",
    ...mutate,
    moneyLimiter,
    handle(async (req, res) => {
      const termsVersion = await purchaseGate(req);
      const deps = purchaseDeps();
      const amount = parseUsdc((req.body ?? {}).amount, "amount");
      const signer = await requireChain().userSigner(me(req));
      send(res, await placeBid(deps, req.params.id, { id: me(req).id, signer, termsVersion }, amount, (req.body ?? {}).brand));
    }),
  );

  // ---------- posts, proof, messages ----------

  // Route handlers with `res` in scope pass it so the per-request role is reused.
  const actor = (req: Request) => ({ id: me(req).id, isReviewer: Boolean(req.res && roleIn(req.res)) });

  router.get("/listings/:id/posts", handle(async (req, res) => send(res, await listPosts(db, req.params.id))));
  router.post(
    "/listings/:id/posts",
    ...mutate,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { url?: unknown; body?: unknown; mediaAssetIds?: unknown };
      const post = await createPost(db, actor(req), req.params.id, {
        url: typeof body.url === "string" ? body.url : undefined,
        body: typeof body.body === "string" ? body.body : undefined,
        mediaAssetIds: Array.isArray(body.mediaAssetIds) ? body.mediaAssetIds.filter((id): id is string => typeof id === "string") : undefined,
      });
      send(res, post, 201);
    }),
  );
  router.delete(
    "/posts/:id",
    ...mutate,
    handle(async (req, res) => {
      await deletePost(db, actor(req), req.params.id);
      send(res, { ok: true });
    }),
  );
  // Manual entry until the X / Instagram metric fetchers are enabled.
  router.post(
    "/posts/:id/metrics",
    ...mutate,
    requireReviewer,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const number = (key: string) => (body[key] === undefined ? undefined : Number(body[key]));
      send(
        res,
        await recordMetrics(db, req.params.id, "manual", {
          views: number("views"),
          likes: number("likes"),
          reposts: number("reposts"),
          replies: number("replies"),
          bookmarks: number("bookmarks"),
        }),
        201,
      );
    }),
  );
  router.post(
    "/spots/:id/proof",
    ...mutate,
    handle(async (req, res) => {
      const context = requireChain();
      const postIds = Array.isArray(req.body?.postIds) ? (req.body.postIds as unknown[]).filter((id): id is string => typeof id === "string") : [];
      const result = await submitSpotProof(
        { db, program: context.program, feePayer: context.reviewer, rentPayer: context.rentPayer, runTx: context.runTx, listingBaseUrl: options.metadataBaseUrl },
        me(req).id,
        await context.userSigner(me(req)),
        req.params.id,
        postIds,
      );
      send(res, result);
    }),
  );
  // Permissionless on-chain; requiring a session just rate-limits and attributes it.
  router.post(
    "/spots/:id/payout",
    ...mutate,
    handle(async (req, res) => {
      const context = requireChain();
      send(
        res,
        await payoutSeller(
          {
            db,
            program: context.program,
            mint: context.mint,
            caller: context.reviewer,
            rentPayer: context.rentPayer.publicKey,
            runTx: context.runTx,
            readListingSnapshot: context.readListingSnapshot,
            readVaultBalance: context.readVaultBalance,
            readTxEvent: context.readTxEvent,
            accountExists: context.accountExists,
          },
          req.params.id,
          me(req).id,
        ),
      );
    }),
  );
  const disputeDeps = (): DisputeDeps => {
    const context = requireChain();
    return {
      db,
      program: context.program,
      mint: context.mint,
      feePayer: context.reviewer,
      rentPayer: context.rentPayer,
      resolver: context.reviewer,
      readConfigAuthority: async () => (await context.readProtocolStatus()).authority,
      squads: context.squads,
      runTx: context.runTx,
      readListingSnapshot: context.readListingSnapshot,
      readVaultBalance: context.readVaultBalance,
      readTxEvent: context.readTxEvent,
      accountExists: context.accountExists,
      readDisputeTimeoutSeconds: context.readDisputeTimeoutSeconds,
      readDisputeRecord: context.readDisputeRecord,
      buyerPaidDisputes: options.buyerPaidDisputes,
      readLamports: context.readLamports,
      listingBaseUrl: options.metadataBaseUrl,
    };
  };
  router.post(
    "/spots/:id/disputes",
    ...mutate,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { reason?: unknown; evidenceAssetIds?: unknown };
      const signer = await requireChain().userSigner(me(req));
      const result = await raiseDispute(disputeDeps(), me(req).id, signer, req.params.id, {
        reason: typeof body.reason === "string" ? body.reason : "",
        evidenceAssetIds: Array.isArray(body.evidenceAssetIds) ? body.evidenceAssetIds.filter((id): id is string => typeof id === "string") : undefined,
      });
      send(res, result, 201);
    }),
  );
  router.post(
    "/spots/:id/disputes/withdraw",
    ...mutate,
    handle(async (req, res) => {
      const signer = await requireChain().userSigner(me(req));
      send(res, await withdrawDispute(disputeDeps(), me(req).id, signer, req.params.id));
    }),
  );
  router.post(
    "/spots/:id/disputes/timeout",
    ...mutate,
    handle(async (req, res) => send(res, await timeoutDispute(disputeDeps(), req.params.id, me(req).id))),
  );
  router.post(
    "/review/spots/:id/resolve",
    ...mutate,
    requireReviewer,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { sellerShareBps?: unknown; decision?: unknown };
      send(
        res,
        await resolveDispute(disputeDeps(), me(req).id, req.params.id, {
          sellerShareBps: Number(body.sellerShareBps),
          decision: typeof body.decision === "string" ? body.decision : "",
        }),
      );
    }),
  );
  const refundDeps = (): RefundDeps => {
    const context = requireChain();
    return {
      db,
      program: context.program,
      mint: context.mint,
      feePayer: context.reviewer,
      rentPayer: context.rentPayer,
      runTx: context.runTx,
      readVaultBalance: context.readVaultBalance,
      accountExists: context.accountExists,
      readListingRentPayers: context.readListingRentPayers,
    };
  };
  // Creators refund with their own signature; sponsors after a missed delivery need none.
  router.post(
    "/spots/:id/refund",
    ...mutate,
    handle(async (req, res) => {
      const context = requireChain();
      const asSeller = req.body?.asSeller === true;
      const result = await refundSpot(refundDeps(), req.params.id, {
        id: me(req).id,
        sellerSigner: asSeller ? await context.userSigner(me(req)) : undefined,
      });
      send(res, result);
    }),
  );
  // Read with the server's RPC so the browser never needs (or exposes) a paid RPC key.
  router.get(
    "/me/balance",
    requireUser,
    handle(async (req, res) => {
      const wallet = me(req).walletAddress;
      if (!wallet) return void send(res, { usdc: "0", wallet: null });
      const usdc = await requireChain().readTokenBalance(new PublicKey(wallet));
      send(res, { usdc, wallet });
    }),
  );
  router.get(
    "/me/withdrawals",
    requireUser,
    handle(async (req, res) => {
      const query = req.query as Record<string, string | undefined>;
      const before = query.before ? new Date(query.before) : undefined;
      if (before && Number.isNaN(before.getTime())) throw new BadRequest("before must be a date");
      send(res, await listWithdrawals(db, me(req).id, Math.min(Math.max(Number(query.limit) || 50, 1), 100), before));
    }),
  );
  const walletDeps = () => {
    const context = requireChain();
    return {
      db,
      mint: context.mint,
      feePayer: context.reviewer,
      prepareTx: context.prepareTx,
      submitTx: context.submitTx,
      readTokenBalance: context.readTokenBalance,
      accountExists: context.accountExists,
      dailyLimit: options.withdrawalDailyLimit ?? 1_000n * 1_000_000n,
    };
  };
  // Withdrawals are signed by the user's own wallet in the browser, where Privy requires their two-factor;
  // the server's delegated signer is not allowed to move USDC (Privy signer policy).
  router.post(
    "/me/withdrawals/prepare",
    ...mutate,
    moneyLimiter,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { destination?: unknown; amount?: unknown };
      const amount = parseUsdc(body.amount, "amount");
      // Refuses accounts without two-factor set up.
      const owner = (await requireChain().userSigner(me(req), { requireMfa: true })).publicKey;
      send(res, await prepareWithdrawal(walletDeps(), me(req).id, owner, typeof body.destination === "string" ? body.destination : "", amount), 201);
    }),
  );
  router.post(
    "/me/withdrawals/:id/submit",
    ...mutate,
    handle(async (req, res) => {
      const signed = (req.body as { transaction?: unknown } | undefined)?.transaction;
      if (typeof signed !== "string" || signed.length > 4000) throw new BadRequest("transaction must be a base64 string");
      send(res, await submitWithdrawal(walletDeps(), me(req).id, req.params.id, signed));
    }),
  );
  // Listing ledger: every transaction, USDC moves and escrow balance checks (reviewers and admins).
  router.get(
    "/review/listings",
    requireUser,
    requireReviewer,
    handle(async (req, res) => send(res, await searchListings(db, typeof req.query.q === "string" ? req.query.q : ""))),
  );
  const ledgerTreasury = async () => (chain ? (await chain.readProtocolStatus().catch(() => undefined))?.treasury?.toString() ?? null : null);
  router.get(
    "/review/listings/:id/ledger",
    requireUser,
    requireReviewer,
    handle(async (req, res) => {
      const ledger = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await listingLedger(db, req.params.id, await ledgerTreasury()) : undefined;
      if (!ledger) return void send(res, { error: "listing not found" }, 404);
      send(res, ledger);
    }),
  );
  router.post(
    "/review/listings/:id/ledger/verify",
    ...mutate,
    requireReviewer,
    handle(async (req, res) => {
      const context = requireChain();
      const ledger = /^[0-9a-f-]{36}$/i.test(req.params.id) ? await listingLedger(db, req.params.id, await ledgerTreasury()) : undefined;
      if (!ledger) return void send(res, { error: "listing not found" }, 404);
      send(res, await verifyLedger(context.connection, ledger.entries));
    }),
  );
  router.post(
    "/review/reconcile",
    ...mutate,
    requireReviewer,
    handle(async (_req, res) => {
      const context = requireChain();
      send(
        res,
        await reconcile({
          db,
          signatureOutcomes: context.signatureOutcomes,
          readSpotStatus: context.readSpotStatus,
          findDisputeResolution: context.findDisputeResolution,
        }),
      );
    }),
  );
  const adminDeps = (): AdminDeps => {
    const context = requireChain();
    return {
      db,
      program: context.program,
      authority: context.reviewer,
      squads: context.squads,
      runTx: context.runTx,
      readProtocolStatus: context.readProtocolStatus,
      readClusterTime: context.readClusterTime,
      adminMessageTtlHours: context.adminMessageTtlHours,
    };
  };
  router.get("/admin/team", requireUser, requireAdmin, handle(async (_req, res) => send(res, await listStaff(db, admins))));
  router.post(
    "/admin/team",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { handle?: unknown; role?: unknown };
      send(res, await grantStaffRole(db, me(req).id, body.handle, body.role, admins));
    }),
  );
  router.delete("/admin/team/:userId", ...mutate, requireAdmin, handle(async (req, res) => send(res, await revokeStaffRole(db, me(req).id, req.params.userId, admins))));
  router.get(
    "/admin/status",
    requireUser,
    handle(async (req, res) => {
      if (!roleIn(res)) return void send(res, { error: "reviewers only" }, 403);
      const context = requireChain();
      const status = await context.readProtocolStatus();
      send(res, {
        ...status,
        authority: status.authority.toBase58(),
        treasury: status.treasury.toBase58(),
        pauseGuardian: status.pauseGuardian?.toBase58() ?? null,
        // Whether the server key can act as the config authority itself, or proposes to the multisig.
        serverIsAuthority: status.authority.equals(context.reviewer.publicKey),
        squadsMultisig: context.squads?.multisig.toBase58() ?? null,
      });
    }),
  );
  router.post(
    "/admin/pause",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      if (typeof req.body?.paused !== "boolean") throw new BadRequest("paused must be true or false");
      const result = await setPaused(adminDeps(), me(req).id, req.body.paused);
      send(res, { paused: result.status.paused, signature: result.signature, pending: result.pending ?? null });
    }),
  );
  // Emergency pause signed by the pause guardian's own wallet, connected in the admin panel only.
  // The server builds and submits the transaction so the browser never needs an RPC.
  const guardianDeps = (): GuardianPauseDeps => {
    const context = requireChain();
    return { db, program: context.program, readProtocolStatus: context.readProtocolStatus, prepareTx: context.prepareTx, submitTx: context.submitTx };
  };
  router.post(
    "/admin/guardian-pause/prepare",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      const wallet = (req.body as { wallet?: unknown } | undefined)?.wallet;
      if (typeof wallet !== "string" || wallet.length > 64) throw new BadRequest("wallet must be a Solana address");
      send(res, await prepareGuardianPause(guardianDeps(), me(req).id, wallet), 201);
    }),
  );
  router.post(
    "/admin/guardian-pause/submit",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { chainTxId?: unknown; transaction?: unknown };
      if (typeof body.chainTxId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.chainTxId)) throw new BadRequest("chainTxId is required");
      if (typeof body.transaction !== "string" || body.transaction.length > 4000) throw new BadRequest("transaction must be a base64 string");
      const result = await submitGuardianPause(guardianDeps(), me(req).id, body.chainTxId, body.transaction);
      send(res, { paused: result.status.paused, signature: result.signature });
    }),
  );
  router.post(
    "/admin/dispute-timeout",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      const result = await setDisputeTimeout(adminDeps(), me(req).id, Number(req.body?.seconds));
      send(res, { disputeTimeoutSeconds: result.status.disputeTimeoutSeconds, signature: result.signature, pending: result.pending ?? null });
    }),
  );
  // Rent reclaim: the platform paid every account's rent, so only admins close unsold spots and
  // finished listings, and the rent returns to the platform's rent payer. Creators never close anything.
  router.get(
    "/admin/rent",
    requireUser,
    requireAdmin,
    handle(async (_req, res) => {
      const context = requireChain();
      send(res, await rentReport({ db, readLamports: context.readLamports, readListingRentPayers: context.readListingRentPayers, serverRentPayer: context.rentPayer.publicKey }));
    }),
  );
  // ---- support ----
  // Everyone on the team hears about new requests: owner admins from env, roles granted in the app,
  // and env reviewers.
  const supportTeam = async () => (await listStaff(db, [...admins, ...reviewers])).map((member) => member.userId);
  const supportViewer = (req: Request, res: Response) => ({ id: me(req).id, isStaff: Boolean(roleIn(res)) });
  const ticketLimiter = perUser(60 * 60_000, 10);
  router.get("/support/tickets", requireUser, handle(async (req, res) => send(res, await listMyTickets(db, me(req).id))));
  router.post(
    "/support/tickets",
    ...mutate,
    ticketLimiter,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      send(res, await createTicket(db, me(req).id, { ...body, userAgent: req.get("user-agent") }, supportTeam), 201);
    }),
  );
  router.get("/support/tickets/:id", requireUser, handle(async (req, res) => send(res, await getTicket(db, supportViewer(req, res), req.params.id))));
  router.post(
    "/support/tickets/:id/messages",
    ...mutate,
    ticketLimiter,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as { message?: unknown; attachmentIds?: unknown };
      send(res, await replyToTicket(db, supportViewer(req, res), req.params.id, body, supportTeam), 201);
    }),
  );
  router.post("/support/tickets/:id/close", ...mutate, handle(async (req, res) => send(res, await closeTicket(db, supportViewer(req, res), req.params.id))));
  // Team queue, by state.
  router.get(
    "/review/support",
    requireUser,
    requireReviewer,
    handle(async (req, res) => {
      const state = ["open", "answered", "closed"].includes(String(req.query.state)) ? (String(req.query.state) as SupportState) : "open";
      send(res, await listTickets(db, state));
    }),
  );

  // Admin numbers: money, marketplace, users and health, from the database plus a few live chain reads.
  router.get(
    "/admin/metrics",
    requireUser,
    requireAdmin,
    handle(async (_req, res) => {
      const chainNumbers = chain ? await readChainMetrics(db, chain, minFeePayerLamports) : null;
      send(res, await adminMetrics(db, chainNumbers));
    }),
  );
  // Reviewer key rotation: once the review authority is the server's new key, move every live listing
  // still recorded to a former key onto it (adopt_listing). Safe to run again; adopted ones are skipped.
  router.post(
    "/admin/listings/adopt",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => {
      const context = requireChain();
      send(
        res,
        await adoptListings(
          {
            db,
            program: context.program,
            reviewer: context.reviewer,
            runTx: context.runTx,
            readReviewAuthority: context.readReviewAuthority,
            readListingRentPayers: context.readListingRentPayers,
          },
          me(req).id,
        ),
      );
    }),
  );
  router.post(
    "/admin/spots/:id/close",
    ...mutate,
    requireAdmin,
    handle(async (req, res) => send(res, await closeSpot(refundDeps(), me(req).id, req.params.id, { force: req.body?.force === true }))),
  );
  router.post("/admin/listings/:id/close", ...mutate, requireAdmin, handle(async (req, res) => send(res, await closeListing(refundDeps(), me(req).id, req.params.id))));
  router.get("/me/dashboard/creator", requireUser, handle(async (req, res) => send(res, await creatorDashboard(db, me(req).id))));
  router.get(
    "/me/dashboard/sponsor",
    requireUser,
    handle(async (req, res) => {
      // Without chain access, fall back to the program default so the page still renders.
      const timeout = chain ? await chain.readDisputeTimeoutSeconds() : 3 * 24 * 60 * 60;
      send(res, await sponsorDashboard(db, me(req).id, timeout));
    }),
  );
  router.get(
    "/me/earnings",
    requireUser,
    handle(async (req, res) => {
      const days = Math.min(Math.max(Number(req.query.days ?? 90) || 90, 1), 365);
      send(res, await creatorEarnings(db, me(req).id, days));
    }),
  );
  router.get(
    "/me/notifications",
    requireUser,
    handle(async (req, res) => {
      const raw = typeof req.query.before === "string" ? new Date(req.query.before) : undefined;
      if (raw && Number.isNaN(raw.getTime())) throw new BadRequest("before must be a date");
      send(res, await listNotifications(db, me(req).id, { before: raw, limit: Number(req.query.limit) || 30 }));
    }),
  );
  router.post(
    "/me/notifications/read",
    ...mutate,
    handle(async (req, res) => {
      const ids = (req.body as { ids?: unknown } | undefined)?.ids;
      send(res, await markRead(db, me(req).id, Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : undefined));
    }),
  );
  router.get("/me/notification-prefs", requireUser, handle(async (req, res) => send(res, await getPrefs(db, me(req).id))));
  router.put("/me/notification-prefs", ...mutate, handle(async (req, res) => send(res, await setPrefs(db, me(req).id, req.body))));
  router.get(
    "/spots/:id/bids",
    handle(async (req, res) => {
      const history = await spotBidHistory(db, req.params.id, req.v2Session?.user.id);
      if (!history) return void send(res, { error: "spot not found" }, 404);
      send(res, history);
    }),
  );
  router.get("/me/watchlist", requireUser, handle(async (req, res) => send(res, await listWatchlist(db, me(req).id))));
  router.put("/me/watchlist/:listingId", ...mutate, handle(async (req, res) => send(res, await watchListing(db, me(req).id, req.params.listingId))));
  router.delete("/me/watchlist/:listingId", ...mutate, handle(async (req, res) => send(res, await unwatchListing(db, me(req).id, req.params.listingId))));
  router.get(
    "/me/activity",
    requireUser,
    handle(async (req, res) => {
      const query = req.query as Record<string, string | undefined>;
      const before = query.before ? new Date(query.before) : undefined;
      if (before && Number.isNaN(before.getTime())) throw new BadRequest("before must be a date");
      send(
        res,
        await activityFeed(db, me(req).id, {
          limit: Math.min(Math.max(Number(query.limit) || 30, 1), 100),
          before,
          role: query.role === "creator" || query.role === "sponsor" ? query.role : undefined,
        }),
      );
    }),
  );
  router.get(
    "/spots/:id",
    requireUser,
    handle(async (req, res) => {
      const timeout = chain ? await chain.readDisputeTimeoutSeconds() : 3 * 24 * 60 * 60;
      send(res, await spotDetail(db, actor(req), req.params.id, timeout, chain?.readDisputeDeadlines));
    }),
  );
  router.get("/spots/:id/timeline", requireUser, handle(async (req, res) => send(res, await spotTimeline(db, actor(req), req.params.id))));
  router.get(
    "/review/summary",
    requireUser,
    requireReviewer,
    handle(async (_req, res) => {
      const timeoutSeconds = chain ? await chain.readDisputeTimeoutSeconds().catch(() => 3 * 24 * 60 * 60) : 3 * 24 * 60 * 60;
      const [summary, openSupport] = await Promise.all([
        reviewSummary(db, new Date(), { readDeadlines: chain?.readDisputeDeadlines, timeoutSeconds }, { proposalStatus: chain?.squads?.proposalStatus }),
        openTicketCount(db),
      ]);
      send(res, { ...summary, counts: { ...summary.counts, openSupport } });
    }),
  );
  router.get("/spots/:id/messages", requireUser, handle(async (req, res) => send(res, await listMessages(db, actor(req), req.params.id))));
  router.post(
    "/spots/:id/messages",
    ...mutate,
    handle(async (req, res) => {
      const text = typeof req.body?.body === "string" ? req.body.body : "";
      send(res, await postMessage(db, actor(req), req.params.id, text), 201);
    }),
  );

  return router;
}
