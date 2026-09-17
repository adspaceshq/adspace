import "dotenv/config";
import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import { Store } from "./store.js";
import {
  cookieOptions,
  createSession,
  destroySession,
  privyConfigured,
  readSession,
  sessionCookieName,
  userFromAccessToken,
  type SessionUser,
} from "./auth.js";
import type { CreateListingRequest } from "./types.js";

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

const store = new Store();
const app = express();
app.use(express.json());
app.use(cookieParser());

const frontend = process.env.FRONTEND_URL ?? "http://localhost:3000";
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", frontend);
  res.header("Access-Control-Allow-Credentials", "true");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, privy-id-token");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const sendErr = (res: Response, e: unknown) => {
  const status = (e as { status?: number }).status ?? 500;
  const message = e instanceof Error ? e.message : "internal error";
  res.status(status).json({ error: message });
};

/** Cookie session, else Bearer Privy access token. */
const attachUser = async (req: Request, _res: Response, next: NextFunction) => {
  const sid = req.cookies?.[sessionCookieName] as string | undefined;
  const fromCookie = readSession(sid);
  if (fromCookie) {
    req.user = fromCookie;
    next();
    return;
  }
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    next();
    return;
  }
  try {
    req.user = await userFromAccessToken(token);
  } catch (e) {
    console.warn("invalid privy token:", e instanceof Error ? e.message : e);
  }
  next();
};

const requireUser = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    res.status(401).json({ error: "log in with X" });
    return;
  }
  next();
};

app.get("/health", (_req, res) => {
  res.json({ status: "ok", auth: privyConfigured ? "privy" : "unconfigured" });
});

app.post("/api/auth/session", async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) {
    res.status(401).json({ error: "missing access token" });
    return;
  }
  const identityToken =
    (typeof req.headers["privy-id-token"] === "string" ? req.headers["privy-id-token"] : undefined) ||
    (req.body as { identityToken?: string } | null)?.identityToken;
  try {
    const user = await userFromAccessToken(token, identityToken);
    const sid = createSession(user);
    res.cookie(sessionCookieName, sid, cookieOptions());
    res.json(user);
  } catch (e) {
    sendErr(res, e);
  }
});

app.get("/api/auth/me", attachUser, (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "not signed in" });
    return;
  }
  res.json(req.user);
});

app.post("/api/auth/logout", (req, res) => {
  destroySession(req.cookies?.[sessionCookieName] as string | undefined);
  res.clearCookie(sessionCookieName, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/listings", (_req, res) => {
  res.json(store.summaries());
});

app.get("/api/listings/:slug", (req, res) => {
  const listing = store.get(req.params.slug);
  if (!listing) {
    res.status(404).json({ error: "listing not found" });
    return;
  }
  res.json(listing);
});

app.post("/api/listings", attachUser, requireUser, (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Partial<CreateListingRequest>;
  if (!body.title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  try {
    const listing = store.create({
      ...body,
      title: body.title,
      seller: req.user!.handle,
      sellerHandle: req.user!.handle,
    });
    res.status(201).json(listing);
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/spots/:id/claim", attachUser, requireUser, (req: Request, res: Response) => {
  try {
    res.json(store.claim(req.params.id, req.user!.handle));
  } catch (e) {
    sendErr(res, e);
  }
});

app.post("/api/spots/:id/bid", attachUser, requireUser, (req: Request, res: Response) => {
  const amount = Number((req.body as { amount?: number } | null)?.amount);
  if (!(amount > 0)) {
    res.status(400).json({ error: "positive amount is required" });
    return;
  }
  try {
    res.json(store.placeBid(req.params.id, req.user!.handle, amount));
  } catch (e) {
    sendErr(res, e);
  }
});

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log(`spotboard api listening on :${port} (auth ${privyConfigured ? "on" : "OFF — set PRIVY_APP_SECRET"})`);
});
