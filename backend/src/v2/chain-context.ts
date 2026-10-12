import { txEventReader, type TxEventReader } from "../chain/events.js";
import type { PrivyClient } from "@privy-io/node";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { associatedTokenAddress, createProgram, pdas, type AdspacesProgram } from "../chain/program.js";
import { prepareChainTx, runChainTx, submitPreparedChainTx, type ChainTxRequest, type ChainTxResult, type PreparedChainTx } from "../chain/runner.js";
import { keypairSigner, privyWalletSigner, type TxSigner } from "../chain/signers.js";
import { loadKeypair } from "../keypair.js";
import type { SessionUser } from "../types.js";
import type { ListingSnapshot } from "../services/settlement.js";
import type { ChainSpotStatus, SignatureOutcome } from "../services/reconciler.js";
import type { ProtocolStatus } from "../services/admin.js";

export interface ChainContext {
  connection: Connection;
  program: AdspacesProgram;
  mint: PublicKey;
  reviewer: TxSigner;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  prepareTx: (request: Omit<ChainTxRequest, "signers">) => Promise<PreparedChainTx>;
  submitTx: (chainTxId: string, signedBase64: string) => Promise<ChainTxResult>;
  // `requireMfa` refuses users without two-factor set up in Privy (withdrawals).
  userSigner: (user: SessionUser, options?: { requireMfa?: boolean }) => Promise<TxSigner>;
  ensureSellerFunding: (seller: PublicKey) => Promise<void>;
  fetchListingDeadline: (listing: PublicKey) => Promise<Date>;
  configFeeFloorBps: () => Promise<number>;
  readListingSnapshot: (listing: PublicKey) => Promise<ListingSnapshot>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  readTxEvent: TxEventReader;
  accountExists: (address: PublicKey) => Promise<boolean>;
  readDisputeTimeoutSeconds: () => Promise<number>;
  readTokenBalance: (owner: PublicKey) => Promise<bigint>;
  signatureOutcomes: (signatures: string[]) => Promise<Map<string, SignatureOutcome>>;
  readSpotStatus: (address: string) => Promise<ChainSpotStatus>;
  readProtocolStatus: () => Promise<ProtocolStatus>;
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
    prepareTx: (request) => prepareChainTx(options.db, connection, request),
    submitTx: (chainTxId, signed) => submitPreparedChainTx(options.db, connection, chainTxId, signed),

    async userSigner(user, signerOptions = {}) {
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
      if (signerOptions.requireMfa && (privyUser.mfa_methods?.length ?? 0) === 0) {
        throw httpError("set up two-factor authentication before withdrawing", 403);
      }
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

    async readListingSnapshot(listing) {
      const account = await program.account.listing.fetch(listing);
      return {
        treasury: account.treasury,
        fees: {
          mode: account.mode === 1 ? "auction" : "fixed",
          feeBps: account.feeBps,
          upliftFeeBps: account.upliftFeeBps,
          maxFeeBps: account.maxFeeBps,
        },
      };
    },

    readTxEvent: txEventReader(connection, program),

    async readVaultBalance(vault) {
      const { value } = await connection.getTokenAccountBalance(vault, "confirmed");
      return BigInt(value.amount);
    },

    async accountExists(address) {
      return (await connection.getAccountInfo(address, "confirmed")) !== null;
    },

    async readTokenBalance(owner) {
      const ata = associatedTokenAddress(owner, new PublicKey(options.mint));
      if (!(await connection.getAccountInfo(ata, "confirmed"))) return 0n;
      const { value } = await connection.getTokenAccountBalance(ata, "confirmed");
      return BigInt(value.amount);
    },

    async signatureOutcomes(signatures) {
      const { value } = await connection.getSignatureStatuses(signatures, { searchTransactionHistory: true });
      return new Map(
        signatures.map((signature, index) => {
          const status = value[index];
          const outcome: SignatureOutcome = !status
            ? "missing"
            : status.err
              ? "failed"
              : status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized"
                ? "confirmed"
                : "missing";
          return [signature, outcome] as const;
        }),
      );
    },

    // Spot layout: discriminator(8) + listing(32) + index(1) + price(8), then the status byte.
    async readSpotStatus(address) {
      const account = await connection.getAccountInfo(new PublicKey(address), "confirmed");
      if (!account) return "closed";
      const statuses: ChainSpotStatus[] = ["open", "funded", "finalized", "cancelled", "disputed"];
      return statuses[account.data[49]] ?? "closed";
    },

    async readProtocolStatus() {
      const config = await program.account.config.fetch(pdas(program.programId).config());
      return {
        authority: config.authority,
        treasury: config.treasury,
        feeBps: config.feeBps,
        paused: config.paused,
        disputeTimeoutSeconds: config.disputeTimeoutSeconds.toNumber(),
      };
    },

    async readDisputeTimeoutSeconds() {
      const config = await program.account.config.fetch(pdas(program.programId).config());
      return config.disputeTimeoutSeconds.toNumber();
    },
  };
}
