import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { chainTxs, mediaAssets, notifications, supportTickets } from "../src/db/schema.js";
import { closeTicket, createTicket, getTicket, listMyTickets, listTickets, openTicketCount, replyToTicket, SupportError } from "../src/services/support.js";
import { createTestDb } from "./helpers/db.js";
import { seedUser } from "./helpers/seed.js";

let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

const valid = { topic: "payments", subject: "where is my payout", message: "the review window ended yesterday but I have not been paid yet." };

async function upload(ownerId: string, kind: "support" | "evidence" = "support") {
  const [asset] = await db
    .insert(mediaAssets)
    .values({ ownerId, kind, url: `https://res.cloudinary.com/x/${kind}/${randomUUID()}.png`, bytes: 10 })
    .returning();
  return asset.id;
}

const notificationsFor = (userId: string, type: string) =>
  db.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.type, type)));

test("a ticket captures its context and tells the user and the team", async () => {
  const { user } = await seedUser(db);
  const { user: reviewer } = await seedUser(db, "reviewer");
  await db.insert(chainTxs).values({ op: "claim_spot", idempotencyKey: `t:${randomUUID()}`, status: "failed", error: "insufficient funds", actorId: user.id });
  const shot = await upload(user.id);
  const listingId = randomUUID();

  const ticket = await createTicket(db, user.id, { ...valid, attachmentIds: [shot], page: "/@lena/macbook", listingId, userAgent: "test" }, async () => [reviewer.id]);

  assert.equal(ticket.state, "open");
  assert.equal(ticket.context.page, "/@lena/macbook");
  assert.equal(ticket.context.listingId, listingId);
  assert.equal(ticket.context.failedTx?.op, "claim_spot");
  assert.equal(ticket.context.failedTx?.error, "insufficient funds");
  assert.equal((await notificationsFor(user.id, "support_received")).length, 1);
  assert.equal((await notificationsFor(reviewer.id, "support_new")).length, 1);

  const view = await getTicket(db, { id: user.id, isStaff: false }, ticket.id);
  assert.equal(view.messages.length, 1);
  assert.equal(view.messages[0].attachments.length, 1);
  assert.ok(!("context" in view), "the user's own view leaves out the internal context");
  assert.deepEqual((await listMyTickets(db, user.id)).map((row) => row.id), [ticket.id]);
});

test("bad input is refused", async () => {
  const { user } = await seedUser(db);
  const { user: other } = await seedUser(db, "other");
  const team = async () => [];
  await assert.rejects(createTicket(db, user.id, { ...valid, topic: "refunds" }, team), SupportError);
  await assert.rejects(createTicket(db, user.id, { ...valid, subject: "hi" }, team), /subject/);
  await assert.rejects(createTicket(db, user.id, { ...valid, message: "help" }, team), /message/);
  await assert.rejects(createTicket(db, user.id, { ...valid, attachmentIds: [await upload(other.id)] }, team), /isn't yours/);
  await assert.rejects(createTicket(db, user.id, { ...valid, attachmentIds: [await upload(user.id, "evidence")] }, team), /isn't yours/);
  const ticket = await createTicket(db, user.id, { ...valid, page: "https://evil.example/x" }, team);
  assert.equal(ticket.context.page, undefined, "only in-app paths are kept");
});

test("strangers can't see a ticket, the team can", async () => {
  const { user } = await seedUser(db);
  const { user: stranger } = await seedUser(db, "stranger");
  const { user: reviewer } = await seedUser(db, "reviewer");
  const ticket = await createTicket(db, user.id, valid, async () => []);
  await assert.rejects(getTicket(db, { id: stranger.id, isStaff: false }, ticket.id), (error: SupportError) => error.status === 404);
  await assert.rejects(getTicket(db, { id: user.id, isStaff: false }, "not-a-uuid"), (error: SupportError) => error.status === 404);
  const staffView = await getTicket(db, { id: reviewer.id, isStaff: true }, ticket.id);
  assert.equal(staffView.user?.handle, user.handle);
  assert.ok(staffView.context);
});

test("replies move the ticket between open and answered, and close or reopen it", async () => {
  const { user } = await seedUser(db);
  const { user: reviewer } = await seedUser(db, "reviewer");
  const team = async () => [reviewer.id];
  const ticket = await createTicket(db, user.id, valid, team);
  const state = async () => (await db.select({ state: supportTickets.state }).from(supportTickets).where(eq(supportTickets.id, ticket.id)))[0].state;

  const reply = await replyToTicket(db, { id: reviewer.id, isStaff: true }, ticket.id, { message: "it is on its way, check your wallet in a minute." }, team);
  assert.equal(reply.fromStaff, true);
  assert.equal(await state(), "answered");
  const [emailed] = await notificationsFor(user.id, "support_reply");
  assert.ok(emailed, "the user is told about the reply");
  assert.equal(emailed.category, "support");

  await replyToTicket(db, { id: user.id, isStaff: false }, ticket.id, { message: "got it, thanks" }, team);
  assert.equal(await state(), "open");
  assert.ok((await notificationsFor(reviewer.id, "support_new")).length >= 2, "the team hears about the follow-up");

  await closeTicket(db, { id: user.id, isStaff: false }, ticket.id);
  assert.equal(await state(), "closed");
  assert.ok((await listTickets(db, "closed")).some((row) => row.id === ticket.id));

  await replyToTicket(db, { id: user.id, isStaff: false }, ticket.id, { message: "one more question" }, team);
  assert.equal(await state(), "open", "a reply reopens a closed ticket");
  assert.ok((await openTicketCount(db)) >= 1);
});
