import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { eq } from "drizzle-orm";
import type { Db } from "../src/db/client.js";
import { disputes, notifications, spotEvents, users, watchlist } from "../src/db/schema.js";
import { ctaLabel, renderNotificationEmail } from "../src/email.js";
import {
  deliverEmails,
  formatUtc,
  getPrefs,
  listNotifications,
  markRead,
  notificationsForEvent,
  processSpotEvents,
  scheduleDisputeNotices,
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

test("withdrawals, closed auctions, payouts and missed deliveries each notify once", async () => {
  const { withdrawals: withdrawalsTable, listings: listingsTable } = await import("../src/db/schema.js");
  const { scheduleWalletNotices, scheduleSettlementNotices } = await import("../src/services/notifications.js");
  const user = await seedUser(db, "wallet");
  await db.insert(withdrawalsTable).values([
    { userId: user.user.id, amount: 5n * USDC, destination: "414exgwxaeBSjajy42RKbmRqKn6o8YesDkGFwnxZNgvn", state: "confirmed" },
    { userId: user.user.id, amount: 2n * USDC, destination: "414exgwxaeBSjajy42RKbmRqKn6o8YesDkGFwnxZNgvn", state: "failed" },
  ]);
  await scheduleWalletNotices(db);
  await scheduleWalletNotices(db);
  assert.deepEqual((await forUser(user.user.id)).map((item) => item.type).sort(), ["withdrawal_failed", "withdrawal_sent"]);

  const auction = await seedListing(db, { mode: "auction", deadline: new Date(Date.now() - HOUR), deliveryDueAt: new Date(Date.now() + 48 * HOUR), funded: true });
  const missed = await seedListing(db, { deadline: new Date(Date.now() - 72 * HOUR), deliveryDueAt: new Date(Date.now() - HOUR), funded: true });
  const delivered = await seedListing(db, { deadline: new Date(Date.now() - 96 * HOUR), deliveryDueAt: new Date(Date.now() - 72 * HOUR), funded: true });
  await db.update(listingsTable).set({ reviewWindowSeconds: 3600 }).where(eq(listingsTable.id, delivered.listing.id));
  await db.update((await import("../src/db/schema.js")).spots).set({ state: "delivered", proofSubmittedAt: new Date(Date.now() - 80 * HOUR) }).where(eq((await import("../src/db/schema.js")).spots.id, delivered.spot.id));

  await scheduleSettlementNotices(db);
  await scheduleSettlementNotices(db);
  assert.deepEqual((await forUser(auction.buyer!.user.id)).map((item) => item.type), ["auction_won"]);
  assert.match((await forUser(auction.seller.user.id))[0].body, /1 of 1 spots sold for \$100\.00/);
  assert.deepEqual((await forUser(missed.buyer!.user.id)).map((item) => item.type), ["refund_available"]);
  assert.deepEqual((await forUser(missed.seller.user.id)).map((item) => item.type), ["delivery_missed"]);
  assert.deepEqual((await forUser(delivered.seller.user.id)).map((item) => item.type), ["payout_ready"]);
});

test("deposits notify only for unexplained incoming USDC, after a first baseline look", async () => {
  const { sessions } = await import("../src/db/schema.js");
  const { detectDeposits } = await import("../src/services/notifications.js");
  const user = await seedUser(db, "depositor");
  await db.insert(sessions).values({ tokenHash: `t-${user.user.id}`, userId: user.user.id, csrfToken: "c", expiresAt: new Date(Date.now() + HOUR) });
  let balance = 10n * USDC;
  const read = async () => balance;

  assert.equal(await detectDeposits(db, read), 0);
  balance = 25n * USDC;
  assert.equal(await detectDeposits(db, read), 1);
  const [deposit] = await forUser(user.user.id);
  assert.equal(deposit.title, "$15.00 USDC received");

  await db.insert(notifications).values({ userId: user.user.id, type: "seller_paid", category: "payments", title: "paid", dedupeKey: `paid-${user.user.id}` });
  balance = 40n * USDC;
  assert.equal(await detectDeposits(db, read), 0);
  balance = 30n * USDC;
  assert.equal(await detectDeposits(db, read), 0);
});

test("notification emails use a contextual button, escape user text and show readable dates", () => {
  assert.equal(formatUtc(new Date("2026-10-13T12:00:00Z")), "oct 13, 12:00 utc");
  assert.equal(formatUtc(new Date("2026-01-05T07:09:00Z")), "jan 5, 07:09 utc");
  const [proof] = notificationsForEvent({
    id: "1",
    type: "proof_submitted",
    actorId: "seller",
    data: {},
    spotId: "spot-1",
    spotIndex: 0,
    buyerId: "buyer",
    sellerId: "seller",
    listingTitle: `<script>alert("x")</script> & co`,
    reviewWindowSeconds: 2 * 24 * 60 * 60,
    deliveryDueAt: new Date("2026-10-11T12:00:00Z"),
  });
  assert.match(proof.body!, /before oct 13, 12:00 utc if/);
  assert.doesNotMatch(proof.body!, /GMT/);

  const email = renderNotificationEmail({ ...proof, body: proof.body!, href: proof.href! }, "https://devnet.adspaces.fun/");
  assert.equal(email.subject, proof.title);
  const has = (text: string, part: string) => assert.ok(text.includes(part), `expected ${JSON.stringify(part)}`);
  has(email.html, ">see the proof</a>");
  assert.ok(!email.html.includes("open adspaces"));
  assert.ok(!email.html.includes("<script>"));
  has(email.html, "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
  has(email.html, 'href="https://devnet.adspaces.fun/dashboard/spots/spot-1"');
  has(email.html, "oct 13, 12:00 utc");
  has(email.html, "attention is everywhere");
  has(email.html, "https://devnet.adspaces.fun/settings#notifications");
  has(email.text, "see the proof: https://devnet.adspaces.fun/dashboard/spots/spot-1");

  assert.equal(ctaLabel("payout_ready"), "collect payout");
  assert.equal(ctaLabel("something_new"), "open adspaces");
  has(renderNotificationEmail({ title: "hi", body: "", href: null }, "https://devnet.adspaces.fun").html, ">open adspaces</a>");
});

test("dispute timeouts: the team hears a day before, then sponsor, creator and team at the timeout, once", async () => {
  const DAY_MS = 24 * HOUR;
  const seed = () => seedListing(db, { deadline: new Date(Date.now() - DAY_MS), deliveryDueAt: new Date(Date.now() + DAY_MS), funded: true });
  const [expired, soon, fresh] = [await seed(), await seed(), await seed()];
  const staff = await seedUser(db, "staff");
  const openDispute = (row: Awaited<ReturnType<typeof seed>>, ageMs: number) =>
    db.insert(disputes).values({ spotId: row.spot.id, buyerId: row.buyer!.user.id, reason: "no photo", openedAt: new Date(Date.now() - ageMs) });
  await openDispute(expired, 4 * DAY_MS);
  await openDispute(soon, 2.5 * DAY_MS);
  await openDispute(fresh, HOUR);

  const deadlines = { timeoutSeconds: 3 * 24 * 60 * 60 };
  const team = async () => [staff.user.id];
  await scheduleDisputeNotices(db, deadlines, team);
  await scheduleDisputeNotices(db, deadlines, team);

  const types = async (userId: string) => (await forUser(userId)).map((item) => item.type).sort();
  assert.deepEqual(await types(expired.buyer!.user.id), ["dispute_refund_available"]);
  assert.deepEqual(await types(expired.seller.user.id), ["dispute_expired"]);
  assert.deepEqual(await types(soon.buyer!.user.id), []);
  assert.deepEqual(await types(fresh.buyer!.user.id), []);
  assert.deepEqual(await types(staff.user.id), ["dispute_due_soon", "dispute_expired_team"]);
  const [refund] = await forUser(expired.buyer!.user.id);
  assert.match(refund.body, /all \$100\.00 can come back/);
  assert.equal(refund.href, `/dashboard/spots/${expired.spot.id}`);
});

test("emails with unsubscribe links carry one-click headers and a footer link", () => {
  const plain = renderNotificationEmail({ title: "hi", body: "", href: null }, "https://devnet.adspaces.fun");
  assert.equal(plain.headers, undefined);
  assert.ok(!plain.html.includes("unsubscribe"));

  const email = renderNotificationEmail({ title: "outbid", body: "", href: null }, "https://devnet.adspaces.fun", {
    category: "bidding",
    pageUrl: "https://devnet.adspaces.fun/unsubscribe?token=abc&x=1",
    oneClickUrl: "https://api-devnet.adspaces.fun/api/v2/email/unsubscribe?token=abc",
  });
  assert.deepEqual(email.headers, {
    "List-Unsubscribe": "<https://api-devnet.adspaces.fun/api/v2/email/unsubscribe?token=abc>",
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  });
  assert.ok(email.html.includes('href="https://devnet.adspaces.fun/unsubscribe?token=abc&amp;x=1"'));
  assert.ok(email.html.includes("unsubscribe from bidding emails</a>"));
  assert.ok(email.text.includes("unsubscribe from bidding emails: https://devnet.adspaces.fun/unsubscribe?token=abc&x=1"));
});
