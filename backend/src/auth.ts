import { PrivyClient, type VerifyAccessTokenResponse } from "@privy-io/node";
import type { AuthenticatedIdentity } from "./types.js";

const appId = process.env.PRIVY_APP_ID ?? "";
const appSecret = process.env.PRIVY_APP_SECRET ?? "";

export const privyConfigured = Boolean(appId && appSecret);

export const privy = privyConfigured ? new PrivyClient({ appId, appSecret }) : null;

const COOKIE = "adspaces_sid";
export const sessionCookieName = COOKIE;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: Number(process.env.SESSION_TTL_HOURS ?? 168) * 60 * 60 * 1000,
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
  subject?: string | null;
  address?: string | null;
  email?: string | null;
  chain_type?: string | null;
  chainType?: string | null;
};

function isXAccount(type: string | undefined): boolean {
  const t = (type ?? "").toLowerCase();
  return t.includes("twitter") || t === "x" || t.includes("x_oauth") || t.endsWith(":x");
}

function xFromAccounts(accounts: Linked[] | undefined): {
  username?: string;
  name?: string;
  avatar?: string;
  subject?: string;
} {
  const tw = (accounts ?? []).find((a) => isXAccount(a.type));
  if (!tw) return {};
  return {
    username: tw.username || tw.user_name || tw.screen_name || undefined,
    name: tw.name || undefined,
    avatar: tw.profile_picture_url || tw.profilePictureUrl || tw.pfp || undefined,
    subject: tw.subject || undefined,
  };
}

function xFromPrivyUser(u: {
  id?: string;
  twitter?: Linked;
  linked_accounts?: Linked[];
  linkedAccounts?: Linked[];
}): { username?: string; name?: string; avatar?: string; subject?: string } {
  if (u.twitter && (u.twitter.username || u.twitter.user_name)) {
    return {
      username: u.twitter.username || u.twitter.user_name || undefined,
      name: u.twitter.name || undefined,
      avatar: u.twitter.profile_picture_url || u.twitter.profilePictureUrl || undefined,
      subject: u.twitter.subject || undefined,
    };
  }
  return xFromAccounts(u.linked_accounts ?? u.linkedAccounts);
}

function accountDetails(accounts: Linked[] | undefined): { email?: string; walletAddress?: string } {
  const emailAccount = (accounts ?? []).find((account) =>
    (account.type ?? "").toLowerCase().includes("email"),
  );
  const solanaWallet = (accounts ?? []).find((account) => {
    const type = (account.type ?? "").toLowerCase();
    const chain = (account.chain_type ?? account.chainType ?? "").toLowerCase();
    return type.includes("wallet") && chain === "solana" && account.address;
  });
  return {
    email: emailAccount?.address ?? emailAccount?.email ?? undefined,
    walletAddress: solanaWallet?.address ?? undefined,
  };
}

/** Verify a Privy access token and load its linked identity and Solana wallet. */
export async function userFromAccessToken(
  token: string,
  identityToken?: string,
): Promise<AuthenticatedIdentity> {
  if (!privy) throw Object.assign(new Error("privy not configured on the API"), { status: 503 });

  let claims: VerifyAccessTokenResponse;
  try {
    claims = await privy.utils().auth().verifyAccessToken(token);
  } catch {
    throw Object.assign(new Error("Privy session expired — log in again"), { status: 401 });
  }
  const did = claims.user_id ?? "";
  if (!did) throw Object.assign(new Error("invalid token claims"), { status: 401 });

  let profile: { username?: string; name?: string; avatar?: string; subject?: string } = {};
  let details: { email?: string; walletAddress?: string } = {};

  if (identityToken) {
    try {
      const fromId = await privy.users().get({ id_token: identityToken });
      if (fromId.id !== did) {
        throw Object.assign(new Error("identity token does not belong to access token user"), {
          status: 401,
        });
      }
      profile = xFromPrivyUser(fromId);
      details = accountDetails(fromId.linked_accounts);
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw e;
      console.warn("privy identity token:", e instanceof Error ? e.message : e);
    }
  }

  if (!profile.username || !profile.subject) {
    try {
      const user = await privy.users()._get(did);
      profile = xFromPrivyUser(user);
      details = accountDetails(user.linked_accounts);
    } catch (e) {
      console.warn("privy users._get:", e instanceof Error ? e.message : e);
    }
  }

  return {
    did,
    xUserId: profile.subject,
    handle: displayHandle(profile.username, did),
    name: profile.name,
    avatar: profile.avatar,
    email: details.email,
    walletAddress: details.walletAddress,
    hasX: Boolean(profile.username && profile.subject),
  };
}
