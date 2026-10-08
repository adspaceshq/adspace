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

// Plain, readable notification email with one link back to the app.
export function renderNotificationEmail(
  notification: { title: string; body: string; href: string | null },
  siteUrl: string,
): Omit<EmailMessage, "to"> {
  const base = siteUrl.replace(/\/$/, "");
  const link = `${base}${notification.href ?? "/dashboard"}`;
  const settings = `${base}/settings#notifications`;
  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#ffffff;padding:40px 16px;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(notification.body)}</div>
    <div style="max-width:600px;margin:0 auto;font-size:16px;line-height:1.7;color:#111111;">
      <p style="margin:0 0 16px;font-weight:bold;">${escape(notification.title)}</p>
      ${notification.body ? `<p style="margin:0 0 16px;">${escape(notification.body)}</p>` : ""}
      <p style="margin:0 0 24px;"><a href="${escape(link)}" style="display:inline-block;background:#020817;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:999px;">open adspaces</a></p>
      <p style="margin:0;font-size:13px;color:#64748b;">you're getting this because of activity on your adspaces account. <a href="${escape(settings)}" style="color:#64748b;">change email settings</a></p>
    </div>
  </body>
</html>`;
  const text = `${notification.title}\n\n${notification.body ? `${notification.body}\n\n` : ""}open adspaces: ${link}\n\nchange email settings: ${settings}`;
  return { subject: notification.title, html, text };
}
