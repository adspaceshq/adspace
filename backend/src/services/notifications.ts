import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listings, notifications, sessions, spotEvents, spots, users, watchlist, withdrawals } from "../db/schema.js";
import { payoutAvailableAt } from "./settlement.js";

export const NOTIFICATION_CATEGORIES = ["sales", "bidding", "delivery", "disputes", "payments", "listings", "messages", "reminders"] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export interface NotificationInput {
  userId: string;
  type: string;
  category: NotificationCategory;
  title: string;
  body?: string;
  href?: string;
  dedupeKey: string;
  // In-app only (e.g. every new bid to the seller); everything else is also emailed.
  inAppOnly?: boolean;
}

const usd = (value: unknown) => {
  const base = BigInt(String(value ?? 0));
  const cents = (base % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `$${(base / 1_000_000n).toLocaleString("en-US")}.${cents}`;
};

// Idempotent: a repeated dedupe key is ignored, so producers can safely re-run.
export async function notify(db: Db, inputs: NotificationInput[]) {
  if (inputs.length === 0) return;
  await db
    .insert(notifications)
    .values(
      inputs.map((input) => ({
        userId: input.userId,
        type: input.type,
        category: input.category,
        title: input.title,
        body: input.body ?? "",
        href: input.href ?? null,
        dedupeKey: input.dedupeKey,
        emailState: input.inAppOnly ? ("skipped" as const) : ("pending" as const),
      })),
    )
    .onConflictDoNothing({ target: notifications.dedupeKey });
}

type EventRow = {
  id: bigint | string;
  type: string;
  actorId: string | null;
  data: unknown;
  spotId: string;
  spotIndex: number;
  buyerId: string | null;
  sellerId: string;
  listingTitle: string;
  reviewWindowSeconds: number;
  deliveryDueAt: Date;
};

// Who hears about each spot event, and what they read.
export function notificationsForEvent(event: EventRow): NotificationInput[] {
  const data = (event.data ?? {}) as Record<string, unknown>;
  const spot = `spot ${event.spotIndex + 1} on "${event.listingTitle}"`;
  const href = `/dashboard/spots/${event.spotId}`;
  const out: NotificationInput[] = [];
  const to = (userId: string | null | undefined, input: Omit<NotificationInput, "userId" | "dedupeKey" | "href">) => {
    if (userId && userId !== event.actorId) out.push({ ...input, userId, href, dedupeKey: `event:${event.id}:${userId}` });
  };
  switch (event.type) {
    case "claimed":
      to(event.sellerId, { type: "spot_claimed", category: "sales", title: `${spot} was claimed`, body: `${usd(data.amount)} is in escrow. deliver and post proof before the due date.` });
      break;
    case "bid_placed":
      to(event.sellerId, { type: "bid_placed", category: "sales", title: `first bid on ${spot}`, body: `${usd(data.amount)} bid.`, inAppOnly: true });
      break;
    case "outbid":
      to(event.sellerId, { type: "bid_placed", category: "sales", title: `new top bid on ${spot}`, body: `${usd(data.amount)} bid.`, inAppOnly: true });
      to(data.previousBidderId as string | null, { type: "outbid", category: "bidding", title: `you were outbid on ${spot}`, body: `the top bid is now ${usd(data.amount)}. your funds are back in your wallet.` });
      break;
    case "proof_submitted": {
      const reviewBy = payoutAvailableAt(event);
      to(event.buyerId, { type: "proof_submitted", category: "delivery", title: `proof is in for ${spot}`, body: `check it and raise a dispute before ${reviewBy.toUTCString()} if something's wrong. otherwise the creator gets paid.` });
      break;
    }
    case "dispute_raised":
      to(event.sellerId, { type: "dispute_raised", category: "disputes", title: `the sponsor disputed ${spot}`, body: "a reviewer will look at the proof and the reason. reply in the spot thread with anything that helps." });
      break;
    case "dispute_withdrawn":
      to(event.sellerId, { type: "dispute_withdrawn", category: "disputes", title: `dispute withdrawn on ${spot}`, body: "your payout is back on track." });
      break;
    case "dispute_resolved":
    case "dispute_timed_out": {
      const title = event.type === "dispute_resolved" ? `dispute resolved on ${spot}` : `dispute timed out on ${spot}`;
      const body = event.type === "dispute_resolved" ? "open the spot to see the decision and the split." : "no decision in time, so the sponsor was refunded.";
      to(event.sellerId, { type: event.type, category: "disputes", title, body });
      to(event.buyerId, { type: event.type, category: "disputes", title, body });
      break;
    }
    case "seller_paid":
      to(event.sellerId, { type: "seller_paid", category: "payments", title: `you got paid for ${spot}`, body: data.gross ? `${usd(BigInt(String(data.gross)) - BigInt(String(data.fee ?? 0)))} is in your wallet after fees.` : "the payout is in your wallet." });
      break;
    case "refunded":
      to(event.buyerId, { type: "refunded", category: "payments", title: `refund sent for ${spot}`, body: `${data.sellerInitiated ? "the creator cancelled. " : ""}${data.amount ? `${usd(data.amount)} is back in your wallet.` : "the funds are back in your wallet."}` });
      break;
  }
  return out;
}

// Turns new spot events into notifications; marks each event so it's handled once.
export async function processSpotEvents(db: Db, limit = 200) {
  const rows = await db
    .select({
      id: spotEvents.id,
      type: spotEvents.type,
      actorId: spotEvents.actorId,
      data: spotEvents.data,
      spotId: spots.id,
      spotIndex: spots.index,
      buyerId: spots.buyerId,
      sellerId: listings.sellerId,
      listingTitle: listings.title,
      reviewWindowSeconds: listings.reviewWindowSeconds,
      deliveryDueAt: listings.deliveryDueAt,
    })
    .from(spotEvents)
    .innerJoin(spots, eq(spots.id, spotEvents.spotId))
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(isNull(spotEvents.notifiedAt))
    .orderBy(asc(spotEvents.createdAt))
    .limit(limit);
  if (rows.length === 0) return 0;
  await notify(db, rows.flatMap(notificationsForEvent));
  await db.update(spotEvents).set({ notifiedAt: new Date() }).where(inArray(spotEvents.id, rows.map((row) => row.id)));
  return rows.length;
}

const DAY = 24 * 60 * 60 * 1000;

// Deadline nudges; dedupe keys make each one fire once.
export async function scheduleReminders(db: Db, now = new Date()) {
  const soon = new Date(now.getTime() + DAY);
  const inputs: NotificationInput[] = [];

  const proofDue = await db
    .select({ spotId: spots.id, index: spots.index, sellerId: listings.sellerId, title: listings.title, dueAt: listings.deliveryDueAt })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(eq(spots.state, "funded"), isNull(spots.proofSubmittedAt), gt(listings.deliveryDueAt, now), lte(listings.deliveryDueAt, soon)));
  for (const row of proofDue) {
    inputs.push({
      userId: row.sellerId,
      type: "proof_due_soon",
      category: "delivery",
      title: `proof due within a day for spot ${row.index + 1} on "${row.title}"`,
      body: `post your proof before ${row.dueAt.toUTCString()} or the sponsor can take a refund.`,
      href: `/dashboard/spots/${row.spotId}`,
      dedupeKey: `reminder:proof_due:${row.spotId}`,
    });
  }

  const reviewing = await db
    .select({ spotId: spots.id, index: spots.index, buyerId: spots.buyerId, title: listings.title, deliveryDueAt: listings.deliveryDueAt, reviewWindowSeconds: listings.reviewWindowSeconds })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.state, "delivered"));
  for (const row of reviewing) {
    const closes = payoutAvailableAt(row);
    if (!row.buyerId || closes <= now || closes > soon) continue;
    inputs.push({
      userId: row.buyerId,
      type: "review_closing",
      category: "delivery",
      title: `review window closes soon for spot ${row.index + 1} on "${row.title}"`,
      body: `after ${closes.toUTCString()} the creator can be paid. dispute before then if the proof isn't right.`,
      href: `/dashboard/spots/${row.spotId}`,
      dedupeKey: `reminder:review_closing:${row.spotId}`,
    });
  }

  const watched = await db
    .select({ userId: watchlist.userId, listingId: listings.id, title: listings.title, slug: listings.slug, handle: users.handle, deadline: listings.deadline })
    .from(watchlist)
    .innerJoin(listings, eq(listings.id, watchlist.listingId))
    .innerJoin(users, eq(users.id, listings.sellerId))
    .where(and(eq(listings.state, "published"), gt(listings.deadline, now), lte(listings.deadline, soon)));
  for (const row of watched) {
    inputs.push({
      userId: row.userId,
      type: "saved_closing",
      category: "reminders",
      title: `"${row.title}" closes within a day`,
      body: "a listing you saved is about to close. claim or bid before it does.",
      href: `/${row.handle}/${row.slug}`,
      dedupeKey: `reminder:saved_closing:${row.listingId}:${row.userId}`,
    });
  }

  await notify(db, inputs);
  return inputs.length;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}
export type EmailSender = (message: EmailMessage) => Promise<void>;

const MAX_ATTEMPTS = 5;

// Sends pending notification emails. Skips unverified addresses and categories the user turned off.
export async function deliverEmails(db: Db, send: EmailSender, render: (n: typeof notifications.$inferSelect) => Omit<EmailMessage, "to">, now = new Date(), limit = 50) {
  const rows = await db
    .select({ notification: notifications, email: users.email, verifiedAt: users.emailVerifiedAt, prefs: users.notificationPrefs })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.userId))
    .where(and(eq(notifications.emailState, "pending"), gt(notifications.createdAt, new Date(now.getTime() - 2 * DAY)), lt(notifications.emailAttempts, MAX_ATTEMPTS)))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
  let sent = 0;
  for (const row of rows) {
    const { notification } = row;
    if (!row.email || !row.verifiedAt || row.prefs[notification.category] === false) {
      await db.update(notifications).set({ emailState: "skipped" }).where(eq(notifications.id, notification.id));
      continue;
    }
    try {
      await send({ to: row.email, ...render(notification) });
      await db.update(notifications).set({ emailState: "sent", emailAttempts: notification.emailAttempts + 1 }).where(eq(notifications.id, notification.id));
      sent += 1;
    } catch (error) {
      const attempts = notification.emailAttempts + 1;
      console.error("notification email failed:", (error as Error).message);
      await db
        .update(notifications)
        .set({ emailAttempts: attempts, emailState: attempts >= MAX_ATTEMPTS ? "failed" : "pending" })
        .where(eq(notifications.id, notification.id));
    }
  }
  return sent;
}

export async function listNotifications(db: Db, userId: string, options: { before?: Date; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
  const items = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      category: notifications.category,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), options.before ? lt(notifications.createdAt, options.before) : undefined))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit);
  const [{ unread }] = await db
    .select({ unread: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return { items, unread };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Keeps `in (...)` non-empty when every id was invalid, so nothing matches.
const NO_ID = "00000000-0000-0000-0000-000000000000";

// Marks the given notifications (or all, when no ids) as read.
export async function markRead(db: Db, userId: string, ids?: string[]) {
  const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(ids === undefined ? mine : and(mine, inArray(notifications.id, ids.filter((id) => UUID.test(id)).slice(0, 100).concat(NO_ID))));
  return { ok: true };
}

export async function getPrefs(db: Db, userId: string) {
  const [row] = await db.select({ prefs: users.notificationPrefs }).from(users).where(eq(users.id, userId));
  return Object.fromEntries(NOTIFICATION_CATEGORIES.map((category) => [category, row?.prefs[category] !== false]));
}

export async function setPrefs(db: Db, userId: string, input: unknown) {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const prefs: Record<string, boolean> = {};
  for (const category of NOTIFICATION_CATEGORIES) {
    if (typeof body[category] === "boolean") prefs[category] = body[category] as boolean;
  }
  await db
    .update(users)
    .set({ notificationPrefs: sql`${users.notificationPrefs} || ${JSON.stringify(prefs)}::jsonb`, updatedAt: new Date() })
    .where(eq(users.id, userId));
  return getPrefs(db, userId);
}

const WEEK = 7 * DAY;
const spotLabel = (index: number, title: string) => `spot ${index + 1} on "${title}"`;

// Withdrawals finish in the request or later via the reconciler; scanning covers both.
export async function scheduleWalletNotices(db: Db, now = new Date()) {
  const rows = await db
    .select({ id: withdrawals.id, userId: withdrawals.userId, amount: withdrawals.amount, destination: withdrawals.destination, state: withdrawals.state })
    .from(withdrawals)
    .where(and(inArray(withdrawals.state, ["confirmed", "failed"]), gt(withdrawals.updatedAt, new Date(now.getTime() - 2 * DAY))));
  const to = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;
  await notify(
    db,
    rows.map((row) =>
      row.state === "confirmed"
        ? {
            userId: row.userId,
            type: "withdrawal_sent",
            category: "payments" as const,
            title: `${usd(row.amount)} withdrawal sent`,
            body: `the USDC is on its way to ${to(row.destination)}. if you didn't do this, secure your account now.`,
            href: "/wallet",
            dedupeKey: `withdrawal:${row.id}:confirmed`,
          }
        : {
            userId: row.userId,
            type: "withdrawal_failed",
            category: "payments" as const,
            title: `${usd(row.amount)} withdrawal didn't go through`,
            body: "nothing left your wallet. try again from your wallet page.",
            href: "/wallet",
            dedupeKey: `withdrawal:${row.id}:failed`,
          },
    ),
  );
  return rows.length;
}

// Results of auctions whose bidding closed in the last week, and money waiting to be collected.
export async function scheduleSettlementNotices(db: Db, now = new Date()) {
  const inputs: NotificationInput[] = [];
  const recentlyClosed = await db
    .select({ spotId: spots.id, index: spots.index, state: spots.state, amount: spots.amount, buyerId: spots.buyerId, listingId: listings.id, title: listings.title, sellerId: listings.sellerId, deliveryDueAt: listings.deliveryDueAt })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(eq(listings.mode, "auction"), lte(listings.deadline, now), gt(listings.deadline, new Date(now.getTime() - WEEK))));
  const byListing = new Map<string, typeof recentlyClosed>();
  for (const row of recentlyClosed) {
    byListing.set(row.listingId, [...(byListing.get(row.listingId) ?? []), row]);
    if (row.buyerId && row.amount !== null && row.state !== "refunded" && row.state !== "cancelled") {
      inputs.push({
        userId: row.buyerId,
        type: "auction_won",
        category: "bidding",
        title: `you won ${spotLabel(row.index, row.title)}`,
        body: `your ${usd(row.amount)} bid is in escrow. the creator delivers by ${row.deliveryDueAt.toUTCString()}.`,
        href: `/dashboard/spots/${row.spotId}`,
        dedupeKey: `auction_won:${row.spotId}`,
      });
    }
  }
  for (const [listingId, rows] of byListing) {
    const sold = rows.filter((row) => row.buyerId && row.amount !== null && row.state !== "refunded" && row.state !== "cancelled");
    const total = sold.reduce((sum, row) => sum + (row.amount ?? 0n), 0n);
    inputs.push({
      userId: rows[0].sellerId,
      type: "auction_closed",
      category: "sales",
      title: `bidding closed on "${rows[0].title}"`,
      body: sold.length ? `${sold.length} of ${rows.length} spots sold for ${usd(total)} in total. deliver and post proof to get paid.` : "no bids this time. you can relist it any time.",
      href: `/sell/listings/${listingId}`,
      dedupeKey: `auction_closed:${listingId}`,
    });
  }

  const active = await db
    .select({ spotId: spots.id, index: spots.index, state: spots.state, buyerId: spots.buyerId, sellerId: listings.sellerId, title: listings.title, deliveryDueAt: listings.deliveryDueAt, reviewWindowSeconds: listings.reviewWindowSeconds, proofSubmittedAt: spots.proofSubmittedAt })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(and(inArray(spots.state, ["funded", "delivered"]), gt(listings.deliveryDueAt, new Date(now.getTime() - 4 * WEEK))));
  for (const row of active) {
    const label = spotLabel(row.index, row.title);
    const href = `/dashboard/spots/${row.spotId}`;
    if (row.state === "delivered" && payoutAvailableAt(row) <= now) {
      inputs.push({ userId: row.sellerId, type: "payout_ready", category: "payments", title: `your payout is ready for ${label}`, body: "the review window closed. collect it from the spot page.", href, dedupeKey: `payout_ready:${row.spotId}` });
    }
    if (row.state === "funded" && !row.proofSubmittedAt && row.deliveryDueAt <= now) {
      if (row.buyerId) {
        inputs.push({ userId: row.buyerId, type: "refund_available", category: "payments", title: `you can take a refund on ${label}`, body: "the creator missed the delivery date. claim your USDC back from the spot page.", href, dedupeKey: `refund_available:${row.spotId}` });
      }
      inputs.push({ userId: row.sellerId, type: "delivery_missed", category: "delivery", title: `delivery date passed for ${label}`, body: "the sponsor can now take a full refund. post proof as soon as you can.", href, dedupeKey: `delivery_missed:${row.spotId}` });
    }
  }
  await notify(db, inputs);
  return inputs.length;
}

// Incoming USDC that isn't explained by something we already announced (payouts, refunds, outbids).
// The first look at a wallet only records its balance.
export async function detectDeposits(db: Db, readTokenBalance: (owner: string) => Promise<bigint>, now = new Date(), limit = 100) {
  const active = await db
    .selectDistinct({ id: users.id, wallet: users.walletAddress, seen: users.usdcSeen, seenAt: users.usdcSeenAt })
    .from(users)
    .innerJoin(sessions, eq(sessions.userId, users.id))
    .where(and(gt(sessions.expiresAt, now), sql`${users.walletAddress} is not null`))
    .limit(limit);
  let found = 0;
  for (const user of active) {
    let balance: bigint;
    try {
      balance = await readTokenBalance(user.wallet!);
    } catch {
      continue;
    }
    if (user.seen !== null && balance > user.seen) {
      const [explained] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, user.id),
            inArray(notifications.type, ["seller_paid", "refunded", "outbid", "dispute_resolved", "dispute_timed_out", "withdrawal_failed"]),
            gt(notifications.createdAt, user.seenAt ?? new Date(0)),
          ),
        )
        .limit(1);
      if (!explained) {
        found += 1;
        await notify(db, [
          {
            userId: user.id,
            type: "deposit_received",
            category: "payments",
            title: `${usd(balance - user.seen)} USDC received`,
            body: `your wallet balance is now ${usd(balance)}.`,
            href: "/wallet",
            dedupeKey: `deposit:${user.id}:${balance}:${now.getTime()}`,
          },
        ]);
      }
    }
    if (user.seen !== balance) await db.update(users).set({ usdcSeen: balance, usdcSeenAt: now }).where(eq(users.id, user.id));
  }
  return found;
}
