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
  }).listen(config.port, () => console.log(`adspaces api listening on :${config.port} (postgres persistence on)`));
}

start().catch((error) => { console.error(error); process.exit(1); });
