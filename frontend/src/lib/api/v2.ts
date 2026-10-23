import type {
  ActivityItem,
  SupportState,
  SupportTicket,
  SupportTicketInput,
  SupportTicketSummary,
  AdminMetrics,
  AdminWallets,
  TeamMember,
  LedgerListingHit,
  LedgerVerification,
  ListingLedger,
  BaseUnits,
  BidHistory,
  AssetKind,
  MediaAsset,
  UploadSignature,
  BrowseFilters,
  BrowsePage,
  CreatorDashboard,
  DraftInput,
  Listing,
  Message,
  OwnedListing,
  Post,
  ProtocolStatus,
  RentReport,
  AdoptListingsReport,
  PublicListing,
  PublicProfile,
  PublicStatus,
  ReviewListingDetail,
  ReviewQueueItem,
  ReviewSummary,
  ReviewDecision,
  Session,
  Settlement,
  SponsorBrand,
  SponsorDashboard,
  Spot,
  SquadsPending,
  SpotDetail,
  TimelineEvent,
  Withdrawal,
  WatchItem,
  AppNotification,
  NotificationCategory,
  UnsubscribeState,
} from "./types";

const BASE = `${(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "")}/api/v2`;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

// The CSRF token comes from the session response; mutations must echo it back.
let csrfToken: string | undefined;
export function setCsrfToken(token: string | undefined) {
  csrfToken = token;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(method !== "GET" && csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  // A proxy or gateway can answer with HTML; treat anything unparseable as no body.
  let json: unknown;
  try {
    json = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    json = undefined;
  }
  if (!response.ok) {
    const message = (json as { error?: string } | undefined)?.error ?? `request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return json as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const enc = encodeURIComponent;

export const api = {
  // Public: whether trading is paused, the cluster and the terms version purchases must send.
  status: () => get<PublicStatus>("/status"),

  auth: {
    exchange: (accessToken: string, identityToken?: string) =>
      request<Session>("POST", "/auth/session", {}, {
        Authorization: `Bearer ${accessToken}`,
        ...(identityToken ? { "privy-id-token": identityToken } : {}),
      }),
    me: () => get<Session>("/auth/me"),
    logout: () => post<{ ok: true }>("/auth/logout"),
  },

  // Unsubscribe links in emails: the signed token stands in for a session.
  email: {
    unsubscribeStatus: (token: string) => get<UnsubscribeState>(`/email/unsubscribe?token=${enc(token)}`),
    unsubscribe: (token: string) => post<UnsubscribeState>("/email/unsubscribe", { token }),
    resubscribe: (token: string) => post<UnsubscribeState>("/email/resubscribe", { token }),
  },

  me: {
    // Finishing onboarding the first time needs the terms version the user agreed to.
    saveOnboarding: (input: object, termsVersion?: string) =>
      request<Session["onboarding"]>("PUT", "/me/onboarding", termsVersion ? { ...input, termsVersion } : input),
    updateProfile: (patch: { displayName?: string; handle?: string; avatar?: string | null; bio?: string; payoutWallet?: string }) => request<PublicProfile>("PATCH", "/me", patch),
    listings: () => get<OwnedListing[]>("/me/listings"),
    listing: (id: string) => get<OwnedListing>(`/me/listings/${enc(id)}`),
    creatorDashboard: () => get<CreatorDashboard>("/me/dashboard/creator"),
    sponsorDashboard: () => get<SponsorDashboard>("/me/dashboard/sponsor"),
    earnings: (days = 90) => get<Array<{ day: string; earned: string }>>(`/me/earnings?days=${days}`),
    activity: (options: { before?: string; role?: "creator" | "sponsor"; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.before) params.set("before", options.before);
      if (options.role) params.set("role", options.role);
      if (options.limit) params.set("limit", String(options.limit));
      const query = params.toString();
      return get<ActivityItem[]>(`/me/activity${query ? `?${query}` : ""}`);
    },
    notifications: (before?: string) =>
      get<{ items: AppNotification[]; unread: number }>(`/me/notifications${before ? `?before=${enc(before)}` : ""}`),
    markRead: (ids?: string[]) => post<{ ok: true }>("/me/notifications/read", ids ? { ids } : {}),
    notificationPrefs: () => get<Record<NotificationCategory, boolean>>("/me/notification-prefs"),
    setNotificationPrefs: (prefs: Partial<Record<NotificationCategory, boolean>>) =>
      request<Record<NotificationCategory, boolean>>("PUT", "/me/notification-prefs", prefs),
    balance: () => get<{ usdc: BaseUnits; wallet: string | null }>("/me/balance"),
    watchlist: () => get<WatchItem[]>("/me/watchlist"),
    watch: (listingId: string) => request<{ listingId: string; watching: boolean }>("PUT", `/me/watchlist/${enc(listingId)}`, {}),
    unwatch: (listingId: string) => request<{ listingId: string; watching: boolean }>("DELETE", `/me/watchlist/${enc(listingId)}`),
    // Newest first; `before` pages back by creation time.
    withdrawals: (options: { before?: string; limit?: number } = {}) => {
      const params = new URLSearchParams();
      if (options.before) params.set("before", options.before);
      if (options.limit) params.set("limit", String(options.limit));
      const query = params.toString();
      return get<Withdrawal[]>(`/me/withdrawals${query ? `?${query}` : ""}`);
    },
    // Two steps: the server prepares the transfer (and pays the fee), the user's wallet signs it in the
    // browser (Privy asks for their two-factor), then the server checks and submits exactly that.
    prepareWithdrawal: (destination: string, amount: string) =>
      post<{ withdrawalId: string; transaction: string }>("/me/withdrawals/prepare", { destination, amount }),
    submitWithdrawal: (withdrawalId: string, transaction: string) =>
      post<{ withdrawal: Withdrawal; signature: string }>(`/me/withdrawals/${enc(withdrawalId)}/submit`, { transaction }),
  },

  handles: {
    available: (handle: string) => get<{ handle?: string; available: boolean; reason?: string }>(`/handles/${enc(handle.replace(/^@/, ""))}/available`),
  },
  users: {
    byHandle: (handle: string) => get<PublicProfile>(`/users/${enc(handle.replace(/^@/, ""))}`),
  },

  listings: {
    published: (filters: BrowseFilters = {}) => {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
      const query = params.toString();
      return get<BrowsePage>(`/listings${query ? `?${query}` : ""}`);
    },
    bySlug: (slug: string) => get<PublicListing>(`/listings/${enc(slug)}`),
    createDraft: (input: DraftInput) => post<{ listing: Listing; spots: Spot[] }>("/listings", input),
    update: (id: string, input: DraftInput) => request<{ listing: Listing; spots: Spot[] }>("PATCH", `/listings/${enc(id)}`, input),
    submit: (id: string) => post<Listing>(`/listings/${enc(id)}/submit`),
    publish: (id: string) => post<Listing>(`/listings/${enc(id)}/publish`),
    // Only drafts and listings that never went live.
    remove: (id: string) => request<{ ok: true }>("DELETE", `/listings/${enc(id)}`),
    posts: (id: string) => get<Post[]>(`/listings/${enc(id)}/posts`),
    createPost: (id: string, input: { url?: string; body?: string; mediaAssetIds?: string[] }) =>
      post<Post>(`/listings/${enc(id)}/posts`, input),
  },

  media: {
    sign: (kind: AssetKind) => post<UploadSignature>("/uploads/sign", { kind }),
    register: (input: { kind: AssetKind; url: string; bytes: number; width?: number; height?: number }) => post<MediaAsset>("/media", input),
  },

  posts: {
    remove: (id: string) => request<{ ok: true }>("DELETE", `/posts/${enc(id)}`),
    recordMetrics: (id: string, metrics: Partial<Record<"views" | "likes" | "reposts" | "replies" | "bookmarks", number>>) =>
      post<unknown>(`/posts/${enc(id)}/metrics`, metrics),
  },

  spots: {
    detail: (id: string) => get<SpotDetail>(`/spots/${enc(id)}`),
    // `termsVersion`: the terms the sponsor agreed to at checkout; the server records it and refuses stale versions.
    claim: (id: string, brand: SponsorBrand, termsVersion: string) =>
      post<{ spot: Spot; signature: string }>(`/spots/${enc(id)}/claim`, { brand, termsVersion }),
    bids: (id: string) => get<BidHistory>(`/spots/${enc(id)}/bids`),
    // `amount` is USDC as a decimal string ("1.5"), like withdrawals; never base units.
    bid: (id: string, amount: string, brand: SponsorBrand, termsVersion: string) =>
      post<{ spot: Spot; signature: string; deadline: string }>(`/spots/${enc(id)}/bid`, { amount, brand, termsVersion }),
    submitProof: (id: string, postIds: string[]) => post<{ spot: Spot; signature: string }>(`/spots/${enc(id)}/proof`, { postIds }),
    payout: (id: string) => post<{ spot: Spot; settlement: Settlement; signature: string }>(`/spots/${enc(id)}/payout`),
    refund: (id: string, asSeller: boolean) =>
      post<{ spot: Spot; settlement: Settlement; signature: string }>(`/spots/${enc(id)}/refund`, { asSeller }),
    raiseDispute: (id: string, reason: string, evidenceAssetIds?: string[]) =>
      post<{ spot: Spot; signature: string }>(`/spots/${enc(id)}/disputes`, { reason, evidenceAssetIds }),
    withdrawDispute: (id: string) => post<{ spot: Spot; signature: string }>(`/spots/${enc(id)}/disputes/withdraw`),
    timeoutDispute: (id: string) =>
      post<{ spot: Spot; settlement: Settlement; signature: string }>(`/spots/${enc(id)}/disputes/timeout`),
    timeline: (id: string) => get<{ events: TimelineEvent[]; settlement: Settlement | null }>(`/spots/${enc(id)}/timeline`),
    messages: (id: string) => get<Message[]>(`/spots/${enc(id)}/messages`),
    sendMessage: (id: string, body: string) => post<Message>(`/spots/${enc(id)}/messages`, { body }),
  },

  support: {
    mine: () => get<SupportTicketSummary[]>("/support/tickets"),
    create: (input: SupportTicketInput) => post<SupportTicketSummary>("/support/tickets", input),
    ticket: (id: string) => get<SupportTicket>(`/support/tickets/${enc(id)}`),
    reply: (id: string, message: string, attachmentIds: string[] = []) => post<{ id: string }>(`/support/tickets/${enc(id)}/messages`, { message, attachmentIds }),
    close: (id: string) => post<{ id: string; state: "closed" }>(`/support/tickets/${enc(id)}/close`),
  },
  review: {
    queue: () => get<ReviewQueueItem[]>("/review/queue"),
    support: (state: SupportState) => get<SupportTicketSummary[]>(`/review/support?state=${state}`),
    listing: (listingId: string) => get<ReviewListingDetail>(`/review/listings/${enc(listingId)}`),
    summary: () => get<ReviewSummary>("/review/summary"),
    decide: (listingId: string, decision: ReviewDecision) => post<Listing>(`/review/listings/${enc(listingId)}`, decision),
    resolveDispute: (spotId: string, sellerShareBps: number, decision: string) =>
      // With the multisig as config authority the decision becomes a Squads proposal (pending), not a settlement.
      // warnings: what members should know before approving (for example the vault's SOL for re-creating token accounts).
      post<{ spot: Spot; settlement?: Settlement; pending?: SquadsPending; signature: string; warnings?: string[] }>(`/review/spots/${enc(spotId)}/resolve`, {
        sellerShareBps,
        decision,
      }),
    reconcile: () => post<unknown>("/review/reconcile"),
    searchListings: (q: string) => get<LedgerListingHit[]>(`/review/listings?q=${enc(q)}`),
    ledger: (listingId: string) => get<ListingLedger>(`/review/listings/${enc(listingId)}/ledger`),
    verifyLedger: (listingId: string) => post<LedgerVerification[]>(`/review/listings/${enc(listingId)}/ledger/verify`),
  },

  admin: {
    status: () => get<ProtocolStatus>("/admin/status"),
    setPaused: (paused: boolean) => post<{ paused: boolean; signature: string | null; pending: SquadsPending | null }>("/admin/pause", { paused }),
    // Emergency pause signed by the guardian's own wallet: the server builds the transaction and submits it.
    prepareGuardianPause: (wallet: string) => post<{ chainTxId: string; transaction: string }>("/admin/guardian-pause/prepare", { wallet }),
    submitGuardianPause: (chainTxId: string, transaction: string) =>
      post<{ paused: boolean; signature: string }>("/admin/guardian-pause/submit", { chainTxId, transaction }),
    setDisputeTimeout: (seconds: number) =>
      post<{ disputeTimeoutSeconds: number; signature: string | null; pending: SquadsPending | null }>("/admin/dispute-timeout", { seconds }),
    team: () => get<TeamMember[]>("/admin/team"),
    addTeamMember: (handle: string, role: "reviewer" | "admin") => post<TeamMember[]>("/admin/team", { handle, role }),
    removeTeamMember: (userId: string) => request<TeamMember[]>("DELETE", `/admin/team/${enc(userId)}`),
    rent: () => get<RentReport>("/admin/rent"),
    metrics: () => get<AdminMetrics>("/admin/metrics"),
    wallets: () => get<AdminWallets>("/admin/wallets"),
    // Without force the server only closes spots past their listing deadline.
    closeSpot: (spotId: string, force = false) => post<{ spot: Spot; signature: string }>(`/admin/spots/${enc(spotId)}/close`, force ? { force: true } : {}),
    closeListing: (listingId: string) => post<{ listing: Listing; signature: string }>(`/admin/listings/${enc(listingId)}/close`),
    // After rotating the reviewer key: moves every live listing on a former key to the current one.
    adoptListings: () => post<AdoptListingsReport>("/admin/listings/adopt"),
  },
};
