import { randomBytes } from "node:crypto";
import { PrivyClient } from "@privy-io/node";
import type { SessionUser } from "./types.js";

export type { SessionUser };

const appId = process.env.PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const privyConfigured = Boolean(appId && appSecret);

export const privy = privyConfigured ? new PrivyClient({ appId, appSecret }) : null;

const COOKIE = "spotboard_sid";
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

const sessions = new Map<string, { user: SessionUser; exp: number }>();

export const sessionCookieName = COOKIE;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS,
  };
}

function displayHandle(twitter?: string | null, did?: string): string {
  if (twitter) {
    const username = twitter.trim().replace(/^@+/, "");
    if (username) return `@${username}`;
  }
  if (did) return `user-${did.slice(-8)}`;
  return "user";
}

type Linked = {
  type?: string;
  username?: string | null;
  user_name?: string | null;
  screen_name?: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
  profilePictureUrl?: string | null;
  pfp?: string | null;
};

function isXAccount(type: string | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  return t.includes("twitter") || t === "x" || t.includes("x_oauth") || t.endsWith(":x");
}

function xFromAccounts(accounts: Linked[] | undefined): {
  username?: string;
  name?: string;
  avatar?: string;
} {
  const tw = (accounts ?? []).find((a) => isXAccount(a.type));
  if (!tw) return {};
  return {
    username: tw.username || tw.user_name || tw.screen_name || undefined,
    name: tw.name || undefined,
    avatar: tw.profile_picture_url || tw.profilePictureUrl || tw.pfp || undefined,
  };
}

function xFromPrivyUser(u: {
  id?: string;
  twitter?: Linked;
  linked_accounts?: Linked[];
  linkedAccounts?: Linked[];
}): { username?: string; name?: string; avatar?: string } {
  if (u.twitter && (u.twitter.username || u.twitter.user_name)) {
    return {
      username: u.twitter.username || u.twitter.user_name || undefined,
      name: u.twitter.name || undefined,
      avatar: u.twitter.profile_picture_url || u.twitter.profilePictureUrl || undefined,
    };
  }
  return xFromAccounts(u.linked_accounts ?? u.linkedAccounts);
}

/** Verify a Privy access token and load the X profile from a verified Privy user. */
export async function userFromAccessToken(
  token: string,
  identityToken?: string,
): Promise<SessionUser> {
  if (!privy) throw Object.assign(new Error("privy not configured on the API"), { status: 503 });

  const claims = await privy.utils().auth().verifyAccessToken(token);
  const did = claims.user_id ?? "";
  if (!did) throw Object.assign(new Error("invalid token claims"), { status: 401 });

  let profile: { username?: string; name?: string; avatar?: string } = {};

  if (identityToken) {
    try {
      const fromId = await privy.users().get({ id_token: identityToken });
      if (fromId.id !== did) {
        throw Object.assign(new Error("identity token does not belong to access token user"), {
          status: 401,
        });
      }
      profile = xFromPrivyUser(fromId);
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw e;
      console.warn("privy identity token:", e instanceof Error ? e.message : e);
    }
  }

  if (!profile.username) {
    try {
      const user = await privy.users()._get(did);
      profile = xFromPrivyUser(user);
    } catch (e) {
      console.warn("privy users._get:", e instanceof Error ? e.message : e);
    }
  }

  if (!profile.username) {
    throw Object.assign(
      new Error(
        "Privy verified the session, but no X account was present. Log out, then log in with X again.",
      ),
      { status: 422 },
    );
  }

  return {
    did,
    handle: displayHandle(profile.username, did),
    name: profile.name,
    avatar: profile.avatar,
  };
}

export function createSession(user: SessionUser): string {
  const id = randomBytes(24).toString("hex");
  sessions.set(id, { user, exp: Date.now() + TTL_MS });
  return id;
}

export function readSession(id: string | undefined): SessionUser | undefined {
  if (!id) return undefined;
  const row = sessions.get(id);
  if (!row) return undefined;
  if (row.exp < Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return row.user;
}

export function destroySession(id: string | undefined) {
  if (id) sessions.delete(id);
}
