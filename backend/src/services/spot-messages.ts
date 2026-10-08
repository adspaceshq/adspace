import { asc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listings, spotMessages, spots, users } from "../db/schema.js";

export class MessageError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export interface Participant {
  id: string;
  isReviewer: boolean;
}

// Only the spot's sponsor, the creator, and reviewers can see or write in the thread.
async function assertParticipant(db: Db, spotId: string, actor: Participant) {
  const [row] = await db
    .select({ buyerId: spots.buyerId, sellerId: listings.sellerId })
    .from(spots)
    .innerJoin(listings, eq(listings.id, spots.listingId))
    .where(eq(spots.id, spotId));
  if (!row) throw new MessageError("spot not found", 404);
  if (!row.buyerId) throw new MessageError("messages open once the spot has a sponsor", 409);
  if (actor.id !== row.buyerId && actor.id !== row.sellerId && !actor.isReviewer) {
    throw new MessageError("this conversation is private", 403);
  }
}

export async function postMessage(db: Db, actor: Participant, spotId: string, body: string) {
  const text = body.trim();
  if (!text || text.length > 2000) throw new MessageError("messages must be 1-2000 characters");
  await assertParticipant(db, spotId, actor);
  const [message] = await db.insert(spotMessages).values({ spotId, authorId: actor.id, body: text }).returning();
  return message;
}

export async function listMessages(db: Db, actor: Participant, spotId: string) {
  await assertParticipant(db, spotId, actor);
  return db
    .select({
      id: spotMessages.id,
      body: spotMessages.body,
      createdAt: spotMessages.createdAt,
      author: { id: users.id, handle: users.handle, displayName: users.displayName, avatarUrl: users.avatarUrl },
    })
    .from(spotMessages)
    .innerJoin(users, eq(users.id, spotMessages.authorId))
    .where(eq(spotMessages.spotId, spotId))
    .orderBy(asc(spotMessages.createdAt));
}
