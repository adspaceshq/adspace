import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/client.js";
import { NOTIFICATION_CATEGORIES, getPrefs, setPrefs } from "./notifications.js";

// Unsubscribe links in emails: a signed user id and category, so one click turns that category off
// without signing in (RFC 8058 one-click). Tokens don't expire: an old email's link must keep working.
type Category = (typeof NOTIFICATION_CATEGORIES)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isCategory = (value: string): value is Category => (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);

const sign = (secret: string, userId: string, category: string) =>
  createHmac("sha256", secret).update(`unsubscribe:${userId}:${category}`).digest("base64url");

// Service categories (support) have no opt-out, so they get no token.
export function unsubscribeToken(secret: string, userId: string, category: string): string | null {
  if (!isCategory(category)) return null;
  return `${userId}.${category}.${sign(secret, userId, category)}`;
}

export function readUnsubscribeToken(secret: string, token: unknown): { userId: string; category: Category } | null {
  if (typeof token !== "string" || token.length > 200) return null;
  const [userId, category, signature, ...rest] = token.split(".");
  if (rest.length || !userId || !category || !signature || !UUID.test(userId) || !isCategory(category)) return null;
  const expected = Buffer.from(sign(secret, userId, category));
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { userId, category };
}

// What the confirmation page shows: the category and whether its emails are still on.
export async function unsubscribeStatus(db: Db, secret: string, token: unknown) {
  const read = readUnsubscribeToken(secret, token);
  if (!read) return null;
  const prefs = await getPrefs(db, read.userId);
  return { category: read.category, subscribed: prefs[read.category] };
}

// Idempotent: unsubscribing twice is fine. Settings can turn the category back on.
export async function unsubscribe(db: Db, secret: string, token: unknown) {
  const read = readUnsubscribeToken(secret, token);
  if (!read) return null;
  await setPrefs(db, read.userId, { [read.category]: false });
  return { category: read.category, subscribed: false };
}

// Turns a category back on from the confirmation page, for a click made by mistake.
export async function resubscribe(db: Db, secret: string, token: unknown) {
  const read = readUnsubscribeToken(secret, token);
  if (!read) return null;
  await setPrefs(db, read.userId, { [read.category]: true });
  return { category: read.category, subscribed: true };
}
