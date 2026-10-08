import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { cookieOptions, userFromAccessToken } from "../auth.js";
import { csrfMatches, isReviewer, type StoredSession } from "../db.js";
import type { Db } from "../db/client.js";
import { AppAuthRepository } from "../repositories/app-auth.js";
import {
  acceptTermsAndPublish,
  createDraft,
  reviewListing,
  submitForReview,
  type DraftInput,
  type ReviewDecision,
} from "../services/listing-lifecycle.js";
import { getPublishedListing, listForSeller, listPublished, reviewQueue } from "../services/listing-queries.js";
import { claimSpot, placeBid } from "../services/spot-purchase.js";
import { createPost, deletePost, listPosts, recordMetrics } from "../services/listing-posts.js";
import { listMessages, postMessage } from "../services/spot-messages.js";
import { submitSpotProof } from "../services/spot-proof.js";
import { payoutSeller } from "../services/settlement.js";
import { raiseDispute, resolveDispute, timeoutDispute, withdrawDispute, type DisputeDeps } from "../services/disputes.js";
import { closeListing, closeSpot, refundSpot, type RefundDeps } from "../services/refunds.js";
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
  console.error("v2 api:", error);
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

export function createV2Router(options: { db: Db; chain?: ChainContext; reviewers: readonly string[]; termsVersion: string; metadataBaseUrl: string }) {
  const { db, chain, reviewers } = options;
  const auth = new AppAuthRepository(db);
  const router = Router();
  const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false });
  const mutationLimiter = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-7", legacyHeaders: false });

  const requireChain = (): ChainContext => {
    if (!chain) throw Object.assign(new Error("on-chain actions are not configured"), { status: 503 });
    return chain;
  };

  const attach = async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.v2Session = await auth.readSession(req.cookies?.[SESSION_COOKIE] as string | undefined);
    } catch (error) {
      console.warn("v2 session:", error instanceof Error ? error.message : error);
    }
    next();
  };
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
  const requireReviewer = (req: Request, res: Response, next: NextFunction) => {
    if (!req.v2Session || !isReviewer(req.v2Session.user, reviewers)) return void send(res, { error: "reviewers only" }, 403);
    next();
  };
  const me = (req: Request) => req.v2Session!.user;
  const mutate = [mutationLimiter, requireUser, requireCsrf];

  router.use(attach);

  // ---------- auth & profile ----------

  const sessionBody = async (session: StoredSession) => ({
    ...session.user,
    csrfToken: session.csrfToken,
    expiresAt: session.expiresAt.toISOString(),
    isReviewer: isReviewer(session.user, reviewers),
    onboarding: await auth.getOnboarding(session.user.id),
  });

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
  router.put("/me/onboarding", ...mutate, handle(async (req, res) => send(res, await auth.saveOnboarding(me(req).id, req.body))));
  router.patch("/me", ...mutate, handle(async (req, res) => send(res, await auth.updateProfile(me(req).id, req.body ?? {}))));
  router.get(
    "/users/:handle",
    handle(async (req, res) => {
      const profile = await auth.getProfileByHandle(req.params.handle);
      if (!profile) return void send(res, { error: "user not found" }, 404);
      send(res, profile);
    }),
  );

  // ---------- listings ----------

  router.get("/listings", handle(async (_req, res) => send(res, await listPublished(db))));
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
  router.post("/listings/:id/submit", ...mutate, handle(async (req, res) => send(res, await submitForReview(db, me(req).id, req.params.id))));
  router.post(
    "/listings/:id/publish",
    ...mutate,
    handle(async (req, res) => {
      const context = requireChain();
      const published = await acceptTermsAndPublish(
        {
          db,
          program: context.program,
          mint: context.mint,
          reviewer: context.reviewer,
          runTx: context.runTx,
          ensureSellerFunding: context.ensureSellerFunding,
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
  router.post(
    "/review/listings/:id",
    ...mutate,
    requireReviewer,
    handle(async (req, res) => {
      const floor = await requireChain().configFeeFloorBps();
      send(res, await reviewListing(db, me(req).id, req.params.id, parseDecision(req.body ?? {}), floor));
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
    };
  };
  router.post(
    "/spots/:id/claim",
    ...mutate,
    handle(async (req, res) => {
      const deps = purchaseDeps();
      const signer = await requireChain().userSigner(me(req));
      send(res, await claimSpot(deps, req.params.id, { id: me(req).id, signer }, (req.body ?? {}).brand));
    }),
  );
  router.post(
    "/spots/:id/bid",
    ...mutate,
    handle(async (req, res) => {
      const deps = purchaseDeps();
      const amount = parseUsdc((req.body ?? {}).amount, "amount");
      const signer = await requireChain().userSigner(me(req));
      send(res, await placeBid(deps, req.params.id, { id: me(req).id, signer }, amount, (req.body ?? {}).brand));
    }),
  );

  // ---------- posts, proof, messages ----------

  const actor = (req: Request) => ({ id: me(req).id, isReviewer: isReviewer(me(req), reviewers) });

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
        { db, program: context.program, feePayer: context.reviewer, runTx: context.runTx, listingBaseUrl: options.metadataBaseUrl },
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
            runTx: context.runTx,
            readListingSnapshot: context.readListingSnapshot,
            readVaultBalance: context.readVaultBalance,
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
      resolver: context.reviewer,
      runTx: context.runTx,
      ensureRent: context.ensureSellerFunding,
      readListingSnapshot: context.readListingSnapshot,
      readVaultBalance: context.readVaultBalance,
      accountExists: context.accountExists,
      readDisputeTimeoutSeconds: context.readDisputeTimeoutSeconds,
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
      runTx: context.runTx,
      readVaultBalance: context.readVaultBalance,
      accountExists: context.accountExists,
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
  router.post(
    "/spots/:id/close",
    ...mutate,
    handle(async (req, res) => {
      const signer = await requireChain().userSigner(me(req));
      send(res, await closeSpot(refundDeps(), me(req).id, signer, req.params.id));
    }),
  );
  router.post(
    "/listings/:id/close",
    ...mutate,
    handle(async (req, res) => {
      const signer = await requireChain().userSigner(me(req));
      send(res, await closeListing(refundDeps(), me(req).id, signer, req.params.id));
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
