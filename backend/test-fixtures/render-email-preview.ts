// Writes a sample notification email to disk for previewing in a browser.
// usage: npx tsx test-fixtures/render-email-preview.ts <out.html> [event type, default proof_submitted]
import { writeFileSync } from "node:fs";
import { renderNotificationEmail } from "../src/email.js";
import { notificationsForEvent } from "../src/services/notifications.js";

const [out, type = "proof_submitted"] = process.argv.slice(2);
if (!out) {
  console.error("usage: npx tsx test-fixtures/render-email-preview.ts <out.html> [event type]");
  process.exit(1);
}

const [notification] = notificationsForEvent({
  id: "preview",
  type,
  actorId: "someone-else",
  data: { amount: "150000000", gross: "150000000", fee: "7500000", previousBidderId: "buyer" },
  spotId: "00000000-0000-0000-0000-000000000001",
  spotIndex: 0,
  buyerId: "buyer",
  sellerId: "seller",
  listingTitle: "my race kit at the berlin marathon",
  reviewWindowSeconds: 2 * 24 * 60 * 60,
  deliveryDueAt: new Date("2026-10-11T12:00:00Z"),
});
if (!notification) {
  console.error(`no email for event type "${type}"`);
  process.exit(1);
}

const email = renderNotificationEmail({ ...notification, body: notification.body ?? "", href: notification.href ?? null }, "https://devnet.adspaces.fun");
writeFileSync(out, email.html);
writeFileSync(out.replace(/\.html?$/, "") + ".txt", email.text);
console.log(`subject: ${email.subject}\nwrote ${out}`);
