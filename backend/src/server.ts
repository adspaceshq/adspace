import "dotenv/config";
import { createApp } from "./index.js";
import { loadConfig } from "./config.js";
import { createDatabasePool, PostgresAuthRepository } from "./db.js";
import { PostgresMarketplaceRepository } from "./market.js";
import { PostgresWithdrawalRepository } from "./withdrawals.js";
import { PrivyWithdrawalSponsor } from "./privy-withdrawal.js";
import { PostgresSellerIdentityRepository, PrivyListingPublisher } from "./listing-chain.js";
import { PrivyFixedClaimExecutor } from "./fixed-claim-chain.js";
import { PrivyAuctionBidExecutor } from "./auction-bid-chain.js";
import { PrivyProofChainExecutor } from "./proof-chain.js";
import { ProgramSettlementExecutor } from "./settlement-chain.js";
import { PrivyDisputeChainExecutor } from "./dispute-chain.js";
import { ProgramDisputeResolutionExecutor } from "./dispute-resolution-chain.js";
import { PrivyRefundChainExecutor } from "./refund-chain.js";
import { PrivyCloseSpotsChainExecutor } from "./close-spots-chain.js";
import { SolanaChainReconciler } from "./chain-reconciliation.js";
import { privy } from "./auth.js";
import { createDb } from "./db/client.js";
import { usdcMintFor } from "./payout.js";
import { TERMS_VERSION } from "./types.js";
import { createChainContext } from "./v2/chain-context.js";
import { createV2Router } from "./v2/router.js";
import { reconcile } from "./services/reconciler.js";
import { deliverEmails, processSpotEvents, scheduleReminders } from "./services/notifications.js";
import { renderNotificationEmail, resendSender } from "./email.js";

async function start() {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl, { max: config.databasePoolSize });
  const auth = new PostgresAuthRepository(pool);
  const market = new PostgresMarketplaceRepository(pool);
  if (!config.solana.rpcUrl) throw new Error("SOLANA_RPC_URL is required for withdrawal verification");
  const withdrawals = new PostgresWithdrawalRepository(pool, config.solana.rpcUrl, config.solana.cluster);
  const withdrawalSponsor = new PrivyWithdrawalSponsor(config.solana.rpcUrl, config.solana.cluster);
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
  const settlementExecutor = config.solana.reviewerWalletPath
    ? new ProgramSettlementExecutor(pool, config.solana.rpcUrl, config.solana.cluster, config.solana.programId, config.solana.reviewerWalletPath)
    : undefined;
  const disputeChainExecutor = config.solana.reviewerWalletPath
    ? new PrivyDisputeChainExecutor(pool, config.solana.rpcUrl, config.solana.programId, config.solana.reviewerWalletPath, config.frontendUrl)
    : undefined;
  const disputeResolutionExecutor = config.solana.reviewerWalletPath
    ? new ProgramDisputeResolutionExecutor(pool,config.solana.rpcUrl,config.solana.cluster,config.solana.programId,config.solana.reviewerWalletPath,config.frontendUrl)
    : undefined;
  const refundChainExecutor=config.solana.reviewerWalletPath?new PrivyRefundChainExecutor(pool,config.solana.rpcUrl,config.solana.programId,config.solana.reviewerWalletPath):undefined;
  const closeSpotsChainExecutor=config.solana.reviewerWalletPath?new PrivyCloseSpotsChainExecutor(pool,config.solana.rpcUrl,config.solana.programId,config.solana.reviewerWalletPath):undefined;
  const chainReconciler=new SolanaChainReconciler(pool,config.solana.rpcUrl);
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
  if (v2Chain && reconcileEveryMs > 0) {
    const run = () =>
      reconcile({ db, signatureOutcomes: v2Chain.signatureOutcomes, readSpotStatus: v2Chain.readSpotStatus })
        .then((report) => {
          if (report.confirmedTxs || report.failedTxs || report.withdrawalsUpdated || report.spotDrift.length) {
            console.log("reconcile:", JSON.stringify(report));
          }
        })
        .catch((error) => console.error("reconcile failed:", error instanceof Error ? error.message : error));
    setInterval(run, reconcileEveryMs).unref();
  }
  // Notifications run without the chain: they read what services already recorded.
  const resendKey = process.env.RESEND_API_KEY?.trim();
  const sendEmail = resendKey ? resendSender(resendKey, process.env.NOTIFICATIONS_FROM_EMAIL || undefined) : undefined;
  if (!sendEmail) console.warn("RESEND_API_KEY not set; notifications are in-app only");
  const notifyEveryMs = Number(process.env.NOTIFY_INTERVAL_MS ?? 30_000);
  if (notifyEveryMs > 0) {
    let running = false;
    const runNotifier = async () => {
      if (running) return;
      running = true;
      try {
        await processSpotEvents(db);
        await scheduleReminders(db);
        if (sendEmail) await deliverEmails(db, sendEmail, (notification) => renderNotificationEmail(notification, config.frontendUrl));
      } catch (error) {
        console.error("notifier failed:", error instanceof Error ? error.message : error);
      } finally {
        running = false;
      }
    };
    setInterval(() => void runNotifier(), notifyEveryMs).unref();
  }
  await auth.migrate();
  await market.migrate();
  await withdrawals.migrate();
  createApp({
    auth,
    market,
    profiles: auth,
    reviewers: config.platformReviewers,
    frontendUrl: config.frontendUrl,
    trustProxy: config.trustProxy,
    chain: { cluster: config.solana.cluster, programId: config.solana.programId },
    withdrawals,
    withdrawalSponsor,
    sellerIdentities,
    listingPublisher,
    fixedClaimExecutor,
    auctionBidExecutor,
    proofChainExecutor,
    settlementExecutor,
    disputeChainExecutor,
    disputeResolutionExecutor,
    refundChainExecutor,
    closeSpotsChainExecutor,
    chainReconciler,
    v2Router,
  }).listen(config.port, () => console.log(`adspaces api listening on :${config.port} (postgres persistence on)`));
}

start().catch((error) => { console.error(error); process.exit(1); });
