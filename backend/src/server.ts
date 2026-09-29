import "dotenv/config";
import { createApp } from "./index.js";
import { loadConfig } from "./config.js";
import { createDatabasePool, PostgresAuthRepository } from "./db.js";
import { PostgresMarketplaceRepository } from "./market.js";
import { PostgresWithdrawalRepository } from "./withdrawals.js";
import { PrivyWithdrawalSponsor } from "./privy-withdrawal.js";
import { PrivyListingPublisher } from "./listing-chain.js";

async function start() {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl, { max: config.databasePoolSize });
  const auth = new PostgresAuthRepository(pool);
  const market = new PostgresMarketplaceRepository(pool);
  if (!config.solana.rpcUrl) throw new Error("SOLANA_RPC_URL is required for withdrawal verification");
  const withdrawals = new PostgresWithdrawalRepository(pool, config.solana.rpcUrl, config.solana.cluster);
  const withdrawalSponsor = new PrivyWithdrawalSponsor(config.solana.rpcUrl, config.solana.cluster);
  const listingPublisher = new PrivyListingPublisher(config.solana.rpcUrl, config.solana.programId);
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
    listingPublisher,
  }).listen(config.port, () => console.log(`adspaces api listening on :${config.port} (postgres persistence on)`));
}

start().catch((error) => { console.error(error); process.exit(1); });
