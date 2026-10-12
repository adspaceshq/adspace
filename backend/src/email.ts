import { Resend } from "resend";
import type { EmailMessage, EmailSender } from "./services/notifications.js";

// Same sender and tone as the waitlist emails.
export function resendSender(apiKey: string, from = "hello@adspaces.fun"): EmailSender {
  const resend = new Resend(apiKey);
  return async (message: EmailMessage) => {
    const { error } = await resend.emails.send({
      from: `adspaces <${from}>`,
      to: message.to,
      replyTo: "adspacesfun@gmail.com",
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) throw new Error(error.message);
  };
}

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// Button label per notification type. Derived at render time, so stored rows need no extra column.
const CTA_LABELS: Record<string, string> = {
  spot_claimed: "post proof",
  bid_placed: "view listing",
  outbid: "view your bid",
  proof_submitted: "see the proof",
  dispute_raised: "review the dispute",
  dispute_withdrawn: "view the spot",
  dispute_resolved: "see the decision",
  dispute_timed_out: "view the spot",
  seller_paid: "open your wallet",
  refunded: "open your wallet",
  proof_due_soon: "post proof",
  review_closing: "see the proof",
  saved_closing: "view listing",
  withdrawal_sent: "open your wallet",
  withdrawal_failed: "open your wallet",
  deposit_received: "open your wallet",
  auction_won: "view your bid",
  auction_closed: "view listing",
  payout_ready: "collect payout",
  refund_available: "claim refund",
  delivery_missed: "post proof",
  message: "reply",
  listing_approved: "view listing",
  listing_changes_requested: "view listing",
  listing_rejected: "view listing",
};

export const ctaLabel = (type: string | null | undefined) => (type && CTA_LABELS[type]) || "open adspaces";

const MAIN_SITE = "https://adspaces.fun";
const X_URL = "https://x.com/adspacesfun";
const LOGO_URL = "https://res.cloudinary.com/jvd3gsf7/image/upload/w_128,f_png/adspaces/static/email/logo.png";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

// Email-client-safe layout (tables, inline styles, 600px max) shared in look with the waitlist welcome email.
export function renderNotificationEmail(
  notification: { title: string; body: string; href: string | null; type?: string | null },
  siteUrl: string,
): Omit<EmailMessage, "to"> {
  const base = siteUrl.replace(/\/$/, "");
  const link = `${base}${notification.href ?? "/dashboard"}`;
  const settings = `${base}/settings#notifications`;
  const cta = ctaLabel(notification.type);
  const title = escape(notification.title);
  const body = notification.body
    ? `<p style="margin:0 0 28px;font-family:${FONT};font-size:16px;line-height:1.6;color:#475569;">${escape(notification.body)}</p>`
    : `<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>`;
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light">
    <meta name="supported-color-schemes" content="light">
    <title>${title}</title>
  </head>
  <body style="margin:0;padding:0;background:#f4f4f4;-webkit-text-size-adjust:100%;">
    <div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f4f4f4;">${escape(notification.body || notification.title)}&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f4f4f4" style="background:#f4f4f4;">
      <tr>
        <td align="center" style="padding:40px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding:0 4px 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:10px;"><a href="${MAIN_SITE}" style="text-decoration:none;"><img src="${LOGO_URL}" width="32" height="32" alt="adspaces" style="display:block;border:0;outline:none;border-radius:8px;"></a></td>
                    <td style="vertical-align:middle;font-family:${FONT};font-size:20px;line-height:1;font-weight:700;letter-spacing:-0.3px;"><a href="${MAIN_SITE}" style="color:#020817;text-decoration:none;">adspaces</a></td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td bgcolor="#ffffff" style="background:#ffffff;border-radius:16px;padding:40px 36px;">
                <h1 style="margin:0 0 12px;font-family:${FONT};font-size:22px;line-height:1.35;font-weight:700;color:#020817;">${title}</h1>
                ${body}
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td align="center" bgcolor="#020817" style="border-radius:999px;background:#020817;">
                      <a href="${escape(link)}" style="display:inline-block;padding:13px 26px;font-family:${FONT};font-size:15px;line-height:1;font-weight:600;color:#ffffff;text-decoration:none;border-radius:999px;">${escape(cta)}</a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:28px 16px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:#64748b;">
                <p style="margin:0 0 6px;font-weight:600;color:#020817;">attention is everywhere</p>
                <p style="margin:0 0 16px;"><a href="${MAIN_SITE}" style="color:#64748b;text-decoration:underline;">adspaces.fun</a>&nbsp;&nbsp;&middot;&nbsp;&nbsp;<a href="${X_URL}" style="color:#64748b;text-decoration:underline;">x.com/adspacesfun</a></p>
                <p style="margin:0;font-size:12px;color:#94a3b8;">you're getting this because of activity on your adspaces account. <a href="${escape(settings)}" style="color:#94a3b8;text-decoration:underline;">change email settings</a></p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
  const text = `${notification.title}\n\n${notification.body ? `${notification.body}\n\n` : ""}${cta}: ${link}\n\n--\nadspaces - attention is everywhere\n${MAIN_SITE} | ${X_URL}\n\nchange email settings: ${settings}`;
  return { subject: notification.title, html, text };
}
