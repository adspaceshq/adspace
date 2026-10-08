import type { PrivyClient } from "@privy-io/node";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { createProgram, pdas, type AdspacesProgram } from "../chain/program.js";
import { runChainTx, type ChainTxRequest, type ChainTxResult } from "../chain/runner.js";
import { keypairSigner, privyWalletSigner, type TxSigner } from "../chain/signers.js";
import { loadKeypair } from "../keypair.js";
import type { SessionUser } from "../types.js";

export interface ChainContext {
  connection: Connection;
  program: AdspacesProgram;
  mint: PublicKey;
  reviewer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  userSigner: (user: SessionUser) => Promise<TxSigner>;
  ensureSellerFunding: (seller: PublicKey) => Promise<void>;
  fetchListingDeadline: (listing: PublicKey) => Promise<Date>;
  configFeeFloorBps: () => Promise<number>;
}

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

export function createChainContext(options: {
  db: Db;
  privy: PrivyClient | null;
  rpcUrl: string;
  mint: string;
  reviewerKeypairPath: string;
  privyAuthorizationKey?: string;
  sellerRentFloorLamports: number;
}): ChainContext {
  const connection = new Connection(options.rpcUrl, "confirmed");
  const program = createProgram(connection);
  const reviewerKeypair = loadKeypair(options.reviewerKeypairPath);
  const reviewer = keypairSigner(reviewerKeypair);

  return {
    connection,
    program,
    mint: new PublicKey(options.mint),
    reviewer,
    runTx: (request) => runChainTx(options.db, connection, request),

    async userSigner(user) {
      if (!options.privy || !options.privyAuthorizationKey) throw httpError("wallet signing is not configured", 503);
      if (!user.walletAddress) throw httpError("set up your wallet first", 409);
      const privyUser = await options.privy.users()._get(user.did);
      const wallet = privyUser.linked_accounts.find(
        (account) =>
          account.type === "wallet" &&
          account.chain_type === "solana" &&
          account.address === user.walletAddress &&
          account.wallet_client_type === "privy",
      );
      if (!wallet || !("id" in wallet) || !wallet.id) throw httpError("your embedded wallet was not found", 409);
      if (!("delegated" in wallet) || !wallet.delegated) throw httpError("enable gasless transactions first", 409);
      return privyWalletSigner(options.privy, wallet.id, user.walletAddress, options.privyAuthorizationKey);
    },

    async ensureSellerFunding(seller) {
      const balance = await connection.getBalance(seller, "confirmed");
      if (balance >= options.sellerRentFloorLamports) return;
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: reviewerKeypair.publicKey,
          toPubkey: seller,
          lamports: options.sellerRentFloorLamports - balance,
        }),
      );
      const signature = await connection.sendTransaction(transaction, [reviewerKeypair]);
      const result = await connection.confirmTransaction(signature, "confirmed");
      if (result.value.err) throw httpError("could not fund rent for publishing", 502);
    },

    async fetchListingDeadline(listing) {
      const account = await program.account.listing.fetch(listing);
      return new Date(account.deadline.toNumber() * 1000);
    },

    async configFeeFloorBps() {
      const config = await program.account.config.fetch(pdas(program.programId).config());
      return config.feeBps;
    },
  };
}
