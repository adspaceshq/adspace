import { and, asc, count, desc, eq, gte, inArray } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { chainTxs, mediaAssets, supportAttachments, supportMessages, supportTickets, users, type SupportContext } from "../db/schema.js";
import { notify, type NotificationInput } from "./notifications.js";

export const SUPPORT_TOPICS = ["buying", "selling", "payments", "disputes", "account", "bug", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export type SupportState = "open" | "answered" | "closed";

const MAX_ATTACHMENTS = 4;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

export class SupportError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface Viewer {
  id: string;
  isStaff: boolean;
}

export interface TicketInput {
  topic?: unknown;
  subject?: unknown;
  message?: unknown;
  attachmentIds?: unknown;
  page?: unknown;
  listingId?: unknown;
  spotId?: unknown;
  userAgent?: unknown;
}

const text = (value: unknown, field: string, min: number, max: number) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed.length < min || trimmed.length > max) throw new SupportError(`${field} must be ${min}-${max} characters`);
  return trimmed;
};
const optionalUuid = (value: unknown) => (typeof value === "string" && UUID.test(value) ? value : undefined);
// Only an in-app path is kept: no hosts, no protocols.
const inAppPath = (value: unknown) => (typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value.slice(0, 300) : undefined);

// Who to tell about a new ticket: everyone on the team (reviewers and admins).
export type TeamLookup = () => Promise<string[]>;

// The user's own uploads of kind "support", in the order given.
async function ownAttachments(db: Db, userId: string, value: unknown): Promise<string[]> {
  const ids = [...new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [])];
  if (ids.length > MAX_ATTACHMENTS) throw new SupportError(`attach at most ${MAX_ATTACHMENTS} screenshots`);
  if (!ids.length) return [];
  const rows = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(and(inArray(mediaAssets.id, ids), eq(mediaAssets.ownerId, userId), eq(mediaAssets.kind, "support")));
  if (rows.length !== ids.length) throw new SupportError("one of the screenshots isn't yours");
  return ids;
}

// Opens a ticket with its first message. The context (page, listing or spot, the latest failed
// transaction) is captured now, so the team can help without asking where the user was.
export async function createTicket(db: Db, userId: string, input: TicketInput, team: TeamLookup, now = new Date()) {
  if (!SUPPORT_TOPICS.includes(input.topic as SupportTopic)) throw new SupportError("pick a topic");
  const topic = input.topic as SupportTopic;
  const subject = text(input.subject, "the subject", 3, 120);
  const body = text(input.message, "the message", 10, 4000);
  const attachments = await ownAttachments(db, userId, input.attachmentIds);

  const [failed] = await db
    .select({ id: chainTxs.id, op: chainTxs.op, error: chainTxs.error, signature: chainTxs.signature, updatedAt: chainTxs.updatedAt })
    .from(chainTxs)
    .where(and(eq(chainTxs.actorId, userId), eq(chainTxs.status, "failed"), gte(chainTxs.updatedAt, new Date(now.getTime() - DAY_MS))))
    .orderBy(desc(chainTxs.updatedAt))
    .limit(1);
  const context: SupportContext = {
    page: inAppPath(input.page),
    listingId: optionalUuid(input.listingId),
    spotId: optionalUuid(input.spotId),
    userAgent: typeof input.userAgent === "string" ? input.userAgent.slice(0, 300) : undefined,
    ...(failed ? { failedTx: { id: failed.id, op: failed.op, error: failed.error, signature: failed.signature, at: failed.updatedAt.toISOString() } } : {}),
  };

  const ticket = await db.transaction(async (trx) => {
    const [created] = await trx.insert(supportTickets).values({ userId, topic, subject, context, createdAt: now, updatedAt: now }).returning();
    const [message] = await trx.insert(supportMessages).values({ ticketId: created.id, authorId: userId, body, createdAt: now }).returning();
    if (attachments.length) {
      await trx.insert(supportAttachments).values(attachments.map((assetId, position) => ({ messageId: message.id, assetId, position })));
    }
    return created;
  });

  const staffIds = (await team()).filter((id) => id !== userId);
  await notify(db, [
    {
      userId,
      type: "support_received",
      category: "support",
      title: "we got your request",
      body: `"${subject}". the adspaces team usually replies within a day. you'll get an email when we do.`,
      href: `/help?ticket=${ticket.id}`,
      dedupeKey: `support:received:${ticket.id}`,
    },
    ...staffIds.map(
      (staffId): NotificationInput => ({
        userId: staffId,
        type: "support_new",
        category: "support",
        title: `new support request: ${subject}`,
        body: `topic: ${topic}.`,
        href: `/review?tab=support&ticket=${ticket.id}`,
        dedupeKey: `support:new:${ticket.id}:${staffId}`,
      }),
    ),
  ]);
  return ticket;
}

// The user's own tickets, most recently active first.
export async function listMyTickets(db: Db, userId: string) {
  return db
    .select({ id: supportTickets.id, topic: supportTickets.topic, subject: supportTickets.subject, state: supportTickets.state, createdAt: supportTickets.createdAt, updatedAt: supportTickets.updatedAt })
    .from(supportTickets)
    .where(eq(supportTickets.userId, userId))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(50);
}

// Team view: tickets in a state, oldest waiting first for open ones, with who asked.
export async function listTickets(db: Db, state: SupportState) {
  return db
    .select({
      id: supportTickets.id,
      topic: supportTickets.topic,
      subject: supportTickets.subject,
      state: supportTickets.state,
      createdAt: supportTickets.createdAt,
      updatedAt: supportTickets.updatedAt,
      userHandle: users.handle,
    })
    .from(supportTickets)
    .innerJoin(users, eq(users.id, supportTickets.userId))
    .where(eq(supportTickets.state, state))
    .orderBy(state === "open" ? asc(supportTickets.updatedAt) : desc(supportTickets.updatedAt))
    .limit(100);
}

async function ticketFor(db: Db, viewer: Viewer, ticketId: string) {
  if (!UUID.test(ticketId)) throw new SupportError("request not found", 404);
  const [ticket] = await db.select().from(supportTickets).where(eq(supportTickets.id, ticketId));
  // A stranger gets the same answer as a missing ticket.
  if (!ticket || (ticket.userId !== viewer.id && !viewer.isStaff)) throw new SupportError("request not found", 404);
  return ticket;
}

// One ticket with its thread. Staff also see who asked and the captured context.
export async function getTicket(db: Db, viewer: Viewer, ticketId: string) {
  const ticket = await ticketFor(db, viewer, ticketId);
  const messages = await db
    .select({ id: supportMessages.id, body: supportMessages.body, fromStaff: supportMessages.fromStaff, createdAt: supportMessages.createdAt })
    .from(supportMessages)
    .where(eq(supportMessages.ticketId, ticket.id))
    .orderBy(asc(supportMessages.createdAt));
  const files = messages.length
    ? await db
        .select({ messageId: supportAttachments.messageId, url: mediaAssets.url, position: supportAttachments.position })
        .from(supportAttachments)
        .innerJoin(mediaAssets, eq(mediaAssets.id, supportAttachments.assetId))
        .where(inArray(supportAttachments.messageId, messages.map((message) => message.id)))
        .orderBy(asc(supportAttachments.position))
    : [];
  const [asker] = viewer.isStaff
    ? await db.select({ handle: users.handle, email: users.email, walletAddress: users.walletAddress }).from(users).where(eq(users.id, ticket.userId))
    : [];
  return {
    id: ticket.id,
    topic: ticket.topic,
    subject: ticket.subject,
    state: ticket.state,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    messages: messages.map((message) => ({ ...message, attachments: files.filter((file) => file.messageId === message.id).map((file) => file.url) })),
    ...(viewer.isStaff ? { context: ticket.context, user: asker ?? null } : {}),
  };
}

// Adds a message. A team reply marks the ticket answered and emails the user; a user reply reopens
// it and tells the team. Replying to a closed ticket reopens it.
export async function replyToTicket(db: Db, viewer: Viewer, ticketId: string, input: { message?: unknown; attachmentIds?: unknown }, team: TeamLookup, now = new Date()) {
  const ticket = await ticketFor(db, viewer, ticketId);
  const fromStaff = viewer.isStaff && ticket.userId !== viewer.id;
  const body = text(input.message, "the message", 1, 4000);
  const attachments = await ownAttachments(db, viewer.id, input.attachmentIds);
  const message = await db.transaction(async (trx) => {
    const [created] = await trx.insert(supportMessages).values({ ticketId: ticket.id, authorId: viewer.id, fromStaff, body, createdAt: now }).returning();
    if (attachments.length) {
      await trx.insert(supportAttachments).values(attachments.map((assetId, position) => ({ messageId: created.id, assetId, position })));
    }
    await trx
      .update(supportTickets)
      .set({ state: fromStaff ? "answered" : "open", updatedAt: now, closedAt: null })
      .where(eq(supportTickets.id, ticket.id));
    return created;
  });

  if (fromStaff) {
    await notify(db, [
      {
        userId: ticket.userId,
        type: "support_reply",
        category: "support",
        title: `the adspaces team replied: ${ticket.subject}`,
        body: body.length > 280 ? `${body.slice(0, 277)}...` : body,
        href: `/help?ticket=${ticket.id}`,
        dedupeKey: `support:reply:${message.id}`,
      },
    ]);
  } else {
    const staffIds = (await team()).filter((id) => id !== viewer.id);
    await notify(
      db,
      staffIds.map((staffId) => ({
        userId: staffId,
        type: "support_new",
        category: "support" as const,
        title: `new reply: ${ticket.subject}`,
        href: `/review?tab=support&ticket=${ticket.id}`,
        dedupeKey: `support:followup:${message.id}:${staffId}`,
        inAppOnly: true,
      })),
    );
  }
  return message;
}

// Either side can close a ticket; a later reply reopens it.
export async function closeTicket(db: Db, viewer: Viewer, ticketId: string, now = new Date()) {
  const ticket = await ticketFor(db, viewer, ticketId);
  await db.update(supportTickets).set({ state: "closed", closedAt: now, updatedAt: now }).where(eq(supportTickets.id, ticket.id));
  return { id: ticket.id, state: "closed" as const };
}

export async function openTicketCount(db: Db) {
  const [row] = await db.select({ n: count() }).from(supportTickets).where(eq(supportTickets.state, "open"));
  return Number(row?.n ?? 0);
}
