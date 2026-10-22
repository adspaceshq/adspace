import { alertNotifier, collectAlerts, type MonitorInput } from "./services/monitor.js";
import { PublicKey } from "@solana/web3.js";
import "dotenv/config";
import { createApp } from "./index.js";
import { loadConfig } from "./config.js";
import { createDatabasePool } from "./db.js";
import { privy } from "./auth.js";
import { createDb } from "./db/client.js";
import { usdcMintFor } from "./payout.js";
import { TERMS_VERSION } from "./types.js";
import { createChainContext } from "./v2/chain-context.js";
import { createV2Router } from "./v2/router.js";
import { coalesce, heliusWebhook } from "./webhooks.js";
import { reconcile } from "./services/reconciler.js";
import { expireUnsignedWithdrawals } from "./services/wallet.js";
import { deliverEmails, detectDeposits, processSpotEvents, scheduleReminders, scheduleSettlementNotices, scheduleWalletNotices } from "./services/notifications.js";
import { renderNotificationEmail, resendSender, type UnsubscribeLinks } from "./email.js";
import { unsubscribeToken } from "./services/unsubscribe.js";

async function start() {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl, { max: config.databasePoolSize });
  if (!config.solana.rpcUrl) throw new Error("SOLANA_RPC_URL is required for on-chain actions");
  const db = createDb(pool);
  const v2Chain = config.solana.reviewerWalletPath
    ? createChainContext({
        db,
        privy,
        rpcUrl: config.solana.rpcUrl,
        mint: usdcMintFor(config.solana.cluster, process.env.USDC_MINT),
        reviewerKeypairPath: config.solana.reviewerWalletPath,
        privyAuthorizationKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
        squadsMultisig: config.solana.squadsMultisig,
        squadsProposalTtlHours: config.solana.squadsProposalTtlHours,
      })
    : undefined;
  const unsubscribeSecret = process.env.EMAIL_UNSUBSCRIBE_SECRET?.trim() || undefined;
  const v2Router = createV2Router({
    db,
    unsubscribeSecret,
    chain: v2Chain,
    reviewers: config.platformReviewers,
    admins: (process.env.PLATFORM_ADMINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    termsVersion: TERMS_VERSION,
    cluster: config.solana.cluster,
    metadataBaseUrl: config.frontendUrl,
    buyerPaidDisputes: process.env.BUYER_PAID_DISPUTES === "true",
    minFeePayerLamports: Number(process.env.MIN_FEE_PAYER_LAMPORTS ?? 1_000_000_000),
    withdrawalDailyLimit: BigInt(Math.round(Number(process.env.WITHDRAWAL_DAILY_LIMIT_USDC ?? 1000) * 1_000_000)),
  });
  const reconcileEveryMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000);
  let lastReconcile: MonitorInput["lastReconcile"];
  // One reconcile at a time, shared by the timer and the Helius webhook.
  let requestReconcile: (() => Promise<void>) | undefined;
  if (v2Chain && reconcileEveryMs > 0) {
    const run = () =>
      reconcile({
        db,
        signatureOutcomes: v2Chain.signatureOutcomes,
        readSpotStatus: v2Chain.readSpotStatus,
        findDisputeResolution: v2Chain.findDisputeResolution,
      })
        .then((report) => {
          lastReconcile = { at: new Date(), report };
          if (report.confirmedTxs || report.failedTxs || report.withdrawalsUpdated || report.disputesResolved || report.spotDrift.length) {
            console.log("reconcile:", JSON.stringify(report));
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          lastReconcile = { at: new Date(), error: message };
          console.error("reconcile failed:", message);
        });
    requestReconcile = coalesce(run);
    setInterval(() => void requestReconcile?.(), reconcileEveryMs).unref();
  }
  // Helius pings us when a transaction touches the program (a Squads execute, a permissionless refund),
  // so those land in seconds instead of waiting for the next timer run. The timer stays as the backstop.
  const heliusSecret = process.env.HELIUS_WEBHOOK_SECRET?.trim();
  const webhooks = heliusSecret && requestReconcile
    ? heliusWebhook({ secret: heliusSecret, onActivity: () => void requestReconcile?.() })
    : undefined;
  if (heliusSecret && !requestReconcile) console.warn("HELIUS_WEBHOOK_SECRET is set but the reconciler is off; webhook not mounted");
  // Notifications run without the chain: they read what services already recorded.
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const sendEmail = resendKey ? resendSender(resendKey, process.env.NOTIFICATIONS_FROM_EMAIL || undefined) : undefined;
  if (!sendEmail) console.warn("RESEND_API_KEY not set; notifications are in-app only");
  // Signed unsubscribe links: a footer link to the app page, and the one-click header mail clients POST to.
  const apiUrl = (process.env.PUBLIC_API_URL?.trim() || process.env.RENDER_EXTERNAL_URL?.trim() || "").replace(/\/$/, "");
  if (sendEmail && (!unsubscribeSecret || !apiUrl)) console.warn("EMAIL_UNSUBSCRIBE_SECRET or PUBLIC_API_URL not set; emails go out without unsubscribe links");
  const unsubscribeLinks = (notification: { userId: string; category: string }): UnsubscribeLinks | undefined => {
    const token = unsubscribeSecret && apiUrl ? unsubscribeToken(unsubscribeSecret, notification.userId, notification.category) : null;
    if (!token) return undefined;
    const query = `token=${encodeURIComponent(token)}`;
    return {
      category: notification.category,
      pageUrl: `${config.frontendUrl.replace(/\/$/, "")}/unsubscribe?${query}`,
      oneClickUrl: `${apiUrl}/api/v2/email/unsubscribe?${query}`,
    };
  };
  const notifyEveryMs = Number(process.env.NOTIFY_INTERVAL_MS ?? 30_000);
  if (notifyEveryMs > 0) {
    let running = false;
    let lastDepositCheck = 0;
    const depositEveryMs = Number(process.env.DEPOSIT_CHECK_INTERVAL_MS ?? 120_000);
    const runNotifier = async () => {
      if (running) return;
      running = true;
      try {
        await processSpotEvents(db);
        await scheduleReminders(db);
        await expireUnsignedWithdrawals(db);
        await scheduleWalletNotices(db);
        await scheduleSettlementNotices(db);
        if (v2Chain && Date.now() - lastDepositCheck >= depositEveryMs) {
          lastDepositCheck = Date.now();
          await detectDeposits(db, (owner) => v2Chain.readTokenBalance(new PublicKey(owner)));
        }
        if (sendEmail) await deliverEmails(db, sendEmail, (notification) => renderNotificationEmail(notification, config.frontendUrl, unsubscribeLinks(notification)));
      } catch (error) {
        console.error("notifier failed:", error instanceof Error ? error.message : error);
      } finally {
        running = false;
      }
    };
    setInterval(() => void runNotifier(), notifyEveryMs).unref();
  }
  // Operator alerts: failed txs, reconciler drift or stalls, and a low fee payer. Logged as ALERT lines
  // and emailed to ALERT_EMAILS (comma-separated), each condition at most once an hour.
  const monitorEveryMs = Number(process.env.MONITOR_INTERVAL_MS ?? 5 * 60 * 1000);
  if (v2Chain && monitorEveryMs > 0) {
    const notifyAlerts = alertNotifier({
      send: sendEmail,
      to: (process.env.ALERT_EMAILS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
      repeatMs: 60 * 60 * 1000,
    });
    const startedAt = new Date();
    const runMonitor = async () => {
      try {
        const feePayerLamports = await v2Chain.connection.getBalance(v2Chain.reviewer.publicKey, "confirmed").catch(() => undefined);
        const alerts = await collectAlerts(db, {
          now: new Date(),
          feePayerLamports,
          minFeePayerLamports: Number(process.env.MIN_FEE_PAYER_LAMPORTS ?? 1_000_000_000),
          // Give the reconciler its first run before calling it stalled.
          lastReconcile: lastReconcile ?? { at: startedAt },
          reconcileEveryMs,
          failedTxWindowMs: monitorEveryMs,
        });
        await notifyAlerts(alerts);
      } catch (error) {
        console.error("monitor failed:", error instanceof Error ? error.message : error);
      }
    };
    setInterval(() => void runMonitor(), monitorEveryMs).unref();
  }
  createApp({
    frontendUrl: config.frontendUrl,
    trustProxy: config.trustProxy,
    chain: { cluster: config.solana.cluster, programId: config.solana.programId },
    v2Router,
    webhooks,
  }).listen(config.port, () => console.log(`adspaces api listening on :${config.port} (postgres persistence on${webhooks ? ", helius webhook on" : ""})`));
}

start().catch((error) => { console.error(error); process.exit(1); });
