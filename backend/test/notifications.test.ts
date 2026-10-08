import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { notifications, spotEvents, users, watchlist } from "../src/db/schema.js";
import { renderNotificationEmail } from "../src/email.js";
import {
  deliverEmails,
  getPrefs,
  listNotifications,
  markRead,
  processSpotEvents,
  scheduleReminders,
  setPrefs,
  type EmailMessage,
} from "../src/services/notifications.js";
import { postMessage } from "../src/services/spot-messages.js";
import { createTestDb } from "./helpers/db.js";
import { seedListing, seedUser, USDC } from "./helpers/seed.js";

const HOUR = 60 * 60 * 1000;
let db: Db;
let close: () => Promise<void>;

before(async () => {
  ({ db, close } = await createTestDb());
});
after(async () => close());

const render = (notification: { title: string; body: string; href: string | null }) => renderNotificationEmail(notification, "https://adspaces.fun");
const forUser = async (userId: string) => (await listNotifications(db, userId)).items;

test("spot events notify the right people once, never the actor", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 72 * HOUR), funded: true });
  const rival = await seedUser(db, "rival");
  await db.insert(spotEvents).values([
    { spotId: spot.id, type: "claimed", actorId: buyer!.user.id, data: { amount: (100n * USDC).toString() } },
    { spotId: spot.id, type: "outbid", actorId: rival.user.id, data: { amount: (150n * USDC).toString(), previousBidderId: buyer!.user.id } },
  ]);

  assert.equal(await processSpotEvents(db), 2);
  assert.equal(await processSpotEvents(db), 0);

  const sellerItems = await forUser(seller.user.id);
  assert.deepEqual(sellerItems.map((item) => item.type).sort(), ["bid_placed", "spot_claimed"]);
  assert.match(sellerItems.find((item) => item.type === "spot_claimed")!.body, /\$100\.00/);
  const buyerItems = await forUser(buyer!.user.id);
  assert.deepEqual(buyerItems.map((item) => item.type), ["outbid"]);
  assert.match(buyerItems[0].body, /\$150\.00/);
  assert.equal((await forUser(rival.user.id)).length, 0);

  const [bid] = await db.select().from(notifications).where(eq(notifications.type, "bid_placed"));
  assert.equal(bid.emailState, "skipped");
});

test("reminders fire once per deadline", async () => {
  const { seller } = await seedListing(db, { deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 12 * HOUR), funded: true });
  const watcherListing = await seedListing(db, { deadline: new Date(Date.now() + 6 * HOUR), deliveryDueAt: new Date(Date.now() + 72 * HOUR) });
  const watcher = await seedUser(db, "watcher");
  await db.insert(watchlist).values({ userId: watcher.user.id, listingId: watcherListing.listing.id });

  await scheduleReminders(db);
  await scheduleReminders(db);
  assert.deepEqual((await forUser(seller.user.id)).map((item) => item.type), ["proof_due_soon"]);
  const saved = await forUser(watcher.user.id);
  assert.deepEqual(saved.map((item) => item.type), ["saved_closing"]);
  assert.equal(saved[0].href, `/${watcherListing.seller.user.handle}/${watcherListing.listing.slug}`);
});

test("emails go to verified addresses for enabled categories and retry on failure", async () => {
  const verified = await seedUser(db, "verified");
  const unverified = await seedUser(db, "unverified");
  const optedOut = await seedUser(db, "optedout");
  await db.update(users).set({ email: "v@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, verified.user.id));
  await db.update(users).set({ email: "o@example.com", emailVerifiedAt: new Date() }).where(eq(users.id, optedOut.user.id));
  await setPrefs(db, optedOut.user.id, { payments: false, bogus: true });
  const make = (userId: string, key: string) => ({ userId, type: "seller_paid", category: "payments", title: "you got paid", body: "$5.00 <b>", href: "/wallet", dedupeKey: key });
  await db.insert(notifications).values([make(verified.user.id, "e1"), make(unverified.user.id, "e2"), make(optedOut.user.id, "e3")]);

  let fail = true;
  const sent: EmailMessage[] = [];
  const sender = async (message: EmailMessage) => {
    if (fail) throw new Error("resend down");
    sent.push(message);
  };
  assert.equal(await deliverEmails(db, sender, render), 0);
  fail = false;
  assert.equal(await deliverEmails(db, sender, render), 1);
  assert.equal(await deliverEmails(db, sender, render), 0);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, "v@example.com");
  assert.match(sent[0].html, /\$5\.00 &lt;b&gt;/);
  assert.match(sent[0].text, /https:\/\/adspaces\.fun\/wallet/);
  const states = Object.fromEntries((await db.select().from(notifications)).filter((row) => ["e1", "e2", "e3"].includes(row.dedupeKey)).map((row) => [row.dedupeKey, [row.emailState, row.emailAttempts]]));
  assert.deepEqual(states, { e1: ["sent", 2], e2: ["skipped", 0], e3: ["skipped", 0] });
  assert.deepEqual(await getPrefs(db, optedOut.user.id), { sales: true, bidding: true, delivery: true, disputes: true, payments: false, listings: true, messages: true, reminders: true });
});

test("messages notify the other party at most hourly, and read state is per user", async () => {
  const { seller, buyer, spot } = await seedListing(db, { deadline: new Date(Date.now() + HOUR), deliveryDueAt: new Date(Date.now() + 72 * HOUR), funded: true });
  await postMessage(db, { id: buyer!.user.id, isReviewer: false }, spot.id, "logo file attached");
  await postMessage(db, { id: buyer!.user.id, isReviewer: false }, spot.id, "and a second note");
  const inbox = await listNotifications(db, seller.user.id);
  assert.equal(inbox.items.filter((item) => item.type === "message").length, 1);
  assert.equal((await forUser(buyer!.user.id)).filter((item) => item.type === "message").length, 0);

  const before = inbox.unread;
  await markRead(db, seller.user.id, ["not-a-uuid"]);
  assert.equal((await listNotifications(db, seller.user.id)).unread, before);
  await markRead(db, buyer!.user.id);
  assert.equal((await listNotifications(db, seller.user.id)).unread, before);
  await markRead(db, seller.user.id);
  assert.equal((await listNotifications(db, seller.user.id)).unread, 0);
});
