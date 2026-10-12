import { alertNotifier, collectAlerts, type MonitorInput } from "./services/monitor.js";
import { PublicKey } from "@solana/web3.js";
import "dotenv/config";
import { createApp } from "./index.js";
import { loadConfig } from "./config.js";
import { createDatabasePool, PostgresAuthRepository } from "./db.js";
import { PostgresMarketplaceRepository } from "./market.js";
import { PostgresSellerIdentityRepository, PrivyListingPublisher } from "./listing-chain.js";
import { PrivyFixedClaimExecutor } from "./fixed-claim-chain.js";
import { PrivyAuctionBidExecutor } from "./auction-bid-chain.js";
import { PrivyProofChainExecutor } from "./proof-chain.js";
import { PrivyDisputeChainExecutor } from "./dispute-chain.js";
import { privy } from "./auth.js";
import { createDb } from "./db/client.js";
import { usdcMintFor } from "./payout.js";
import { TERMS_VERSION } from "./types.js";
import { createChainContext } from "./v2/chain-context.js";
import { createV2Router } from "./v2/router.js";
import { reconcile } from "./services/reconciler.js";
import { expireUnsignedWithdrawals } from "./services/wallet.js";
import { deliverEmails, detectDeposits, processSpotEvents, scheduleReminders, scheduleSettlementNotices, scheduleWalletNotices } from "./services/notifications.js";
import { renderNotificationEmail, resendSender } from "./email.js";

async function start() {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl, { max: config.databasePoolSize });
  const auth = new PostgresAuthRepository(pool);
  const market = new PostgresMarketplaceRepository(pool);
  if (!config.solana.rpcUrl) throw new Error("SOLANA_RPC_URL is required for on-chain actions");
  const sellerIdentities = new PostgresSellerIdentityRepository(pool);
  const listingPublisher = config.solana.reviewerWalletPath
    ? new PrivyListingPublisher(
        config.solana.rpcUrl,
        config.solana.cluster,
        config.solana.programId,
        config.solana.reviewerWalletPath,
        config.frontendUrl,
      )
    : undefined;
  const fixedClaimExecutor = config.solana.reviewerWalletPath
    ? new PrivyFixedClaimExecutor(pool, config.solana.rpcUrl, config.solana.cluster, config.solana.programId, config.solana.reviewerWalletPath)
    : undefined;
  const auctionBidExecutor = config.solana.reviewerWalletPath
    ? new PrivyAuctionBidExecutor(pool, config.solana.rpcUrl, config.solana.cluster, config.solana.programId, config.solana.reviewerWalletPath)
    : undefined;
  const proofChainExecutor = config.solana.reviewerWalletPath
    ? new PrivyProofChainExecutor(pool, config.solana.rpcUrl, config.solana.programId, config.solana.reviewerWalletPath, config.frontendUrl)
    : undefined;
  const disputeChainExecutor = config.solana.reviewerWalletPath
    ? new PrivyDisputeChainExecutor(pool, config.solana.rpcUrl, config.solana.programId, config.solana.reviewerWalletPath, config.frontendUrl)
    : undefined;
  const db = createDb(pool);
  const v2Chain = config.solana.reviewerWalletPath
    ? createChainContext({
        db,
        privy,
        rpcUrl: config.solana.rpcUrl,
        mint: usdcMintFor(config.solana.cluster, process.env.USDC_MINT),
        reviewerKeypairPath: config.solana.reviewerWalletPath,
        privyAuthorizationKey: process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY,
        sellerRentFloorLamports: config.solana.cluster === "devnet" ? 50_000_000 : 10_000_000,
      })
    : undefined;
  const v2Router = createV2Router({
    db,
    chain: v2Chain,
    reviewers: config.platformReviewers,
    admins: (process.env.PLATFORM_ADMINS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean),
    termsVersion: TERMS_VERSION,
    metadataBaseUrl: config.frontendUrl,
    withdrawalDailyLimit: BigInt(Math.round(Number(process.env.WITHDRAWAL_DAILY_LIMIT_USDC ?? 1000) * 1_000_000)),
  });
  const reconcileEveryMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 5 * 60 * 1000);
  let lastReconcile: MonitorInput["lastReconcile"];
  if (v2Chain && reconcileEveryMs > 0) {
    const run = () =>
      reconcile({ db, signatureOutcomes: v2Chain.signatureOutcomes, readSpotStatus: v2Chain.readSpotStatus })
        .then((report) => {
          lastReconcile = { at: new Date(), report };
          if (report.confirmedTxs || report.failedTxs || report.withdrawalsUpdated || report.spotDrift.length) {
            console.log("reconcile:", JSON.stringify(report));
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          lastReconcile = { at: new Date(), error: message };
          console.error("reconcile failed:", message);
        });
    setInterval(run, reconcileEveryMs).unref();
  }
  // Notifications run without the chain: they read what services already recorded.
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const sendEmail = resendKey ? resendSender(resendKey, process.env.NOTIFICATIONS_FROM_EMAIL || undefined) : undefined;
  if (!sendEmail) console.warn("RESEND_API_KEY not set; notifications are in-app only");
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
        if (sendEmail) await deliverEmails(db, sendEmail, (notification) => renderNotificationEmail(notification, config.frontendUrl));
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
  await auth.migrate();
  await market.migrate();
  createApp({
    auth,
    market,
    profiles: auth,
    reviewers: config.platformReviewers,
    frontendUrl: config.frontendUrl,
    trustProxy: config.trustProxy,
    chain: { cluster: config.solana.cluster, programId: config.solana.programId },
    sellerIdentities,
    listingPublisher,
    fixedClaimExecutor,
    auctionBidExecutor,
    proofChainExecutor,
    disputeChainExecutor,
    v2Router,
  }).listen(config.port, () => console.log(`adspaces api listening on :${config.port} (postgres persistence on)`));
}

start().catch((error) => { console.error(error); process.exit(1); });
