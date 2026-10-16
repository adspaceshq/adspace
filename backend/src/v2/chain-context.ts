import { txEventReader, type TxEventReader } from "../chain/events.js";
import type { PrivyClient } from "@privy-io/node";
import { Connection, PublicKey } from "@solana/web3.js";
import type { Db } from "../db/client.js";
import { associatedTokenAddress, createProgram, pdas, type AdspacesProgram } from "../chain/program.js";
import { prepareChainTx, runChainTx, submitPreparedChainTx, type ChainTxRequest, type ChainTxResult, type PreparedChainTx } from "../chain/runner.js";
import { keypairSigner, privyWalletSigner, type TxSigner } from "../chain/signers.js";
import { createSquadsProposer, type SquadsProposer } from "../chain/squads.js";
import { loadKeypair } from "../keypair.js";
import type { SessionUser } from "../types.js";
import type { ListingSnapshot } from "../services/settlement.js";
import type { ChainSpotStatus, SignatureOutcome } from "../services/reconciler.js";
import type { ProtocolStatus } from "../services/admin.js";
import type { DisputeResolution } from "../services/disputes.js";

export interface ChainContext {
  connection: Connection;
  program: AdspacesProgram;
  mint: PublicKey;
  reviewer: TxSigner;
  // Pays all account rent and receives it back; recorded on-chain per listing. Today the reviewer key.
  rentPayer: TxSigner;
  // Set with SQUADS_MULTISIG: the reviewer key proposes (Initiate only) what the multisig vault must sign.
  squads?: SquadsProposer;
  runTx: (request: ChainTxRequest) => Promise<ChainTxResult>;
  prepareTx: (request: Omit<ChainTxRequest, "signers">) => Promise<PreparedChainTx>;
  submitTx: (chainTxId: string, signedBase64: string) => Promise<ChainTxResult>;
  // `requireMfa` refuses users without two-factor set up in Privy (withdrawals).
  userSigner: (user: SessionUser, options?: { requireMfa?: boolean }) => Promise<TxSigner>;
  fetchListingDeadline: (listing: PublicKey) => Promise<Date>;
  configFeeFloorBps: () => Promise<number>;
  readListingSnapshot: (listing: PublicKey) => Promise<ListingSnapshot>;
  readVaultBalance: (vault: PublicKey) => Promise<bigint>;
  readTxEvent: TxEventReader;
  accountExists: (address: PublicKey) => Promise<boolean>;
  // Lamports per account in input order, null for accounts that don't exist.
  readLamports: (addresses: PublicKey[]) => Promise<Array<number | null>>;
  readDisputeTimeoutSeconds: () => Promise<number>;
  // When each spot's dispute times out: opened_at plus the timeout captured at raise. Null without a dispute account.
  readDisputeDeadlines: (spotAddresses: string[]) => Promise<Array<Date | null>>;
  readTokenBalance: (owner: PublicKey) => Promise<bigint>;
  signatureOutcomes: (signatures: string[]) => Promise<Map<string, SignatureOutcome>>;
  readSpotStatus: (address: string) => Promise<ChainSpotStatus>;
  readProtocolStatus: () => Promise<ProtocolStatus>;
  findDisputeResolution: (spotAddress: string, decisionHash: string) => Promise<DisputeResolution | null>;
}

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

export function createChainContext(options: {
  db: Db;
  privy: PrivyClient | null;
  rpcUrl: string;
  mint: string;
  reviewerKeypairPath: string;
  privyAuthorizationKey?: string;
  squadsMultisig?: string;
}): ChainContext {
  const connection = new Connection(options.rpcUrl, "confirmed");
  const program = createProgram(connection);
  const reviewer = keypairSigner(loadKeypair(options.reviewerKeypairPath));
  const readTxEvent = txEventReader(connection, program);

  return {
    connection,
    program,
    mint: new PublicKey(options.mint),
    reviewer,
    rentPayer: reviewer,
    squads: options.squadsMultisig ? createSquadsProposer(connection, new PublicKey(options.squadsMultisig), reviewer) : undefined,
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

    readTxEvent,

    async readVaultBalance(vault) {
      const { value } = await connection.getTokenAccountBalance(vault, "confirmed");
      return BigInt(value.amount);
    },

    async accountExists(address) {
      return (await connection.getAccountInfo(address, "confirmed")) !== null;
    },

    // getMultipleAccountsInfo takes at most 100 keys per call.
    async readLamports(addresses) {
      const out: Array<number | null> = [];
      for (let start = 0; start < addresses.length; start += 100) {
        const accounts = await connection.getMultipleAccountsInfo(addresses.slice(start, start + 100), "confirmed");
        out.push(...accounts.map((account) => account?.lamports ?? null));
      }
      return out;
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
      const configKey = pdas(program.programId).config();
      const [config, guardian] = await Promise.all([
        program.account.config.fetch(configKey),
        program.account.pauseGuardian.fetchNullable(pdas(program.programId).pauseGuardian(configKey)),
      ]);
      return {
        authority: config.authority,
        treasury: config.treasury,
        feeBps: config.feeBps,
        paused: config.paused,
        disputeTimeoutSeconds: config.disputeTimeoutSeconds.toNumber(),
        // The default key means the guardian was disabled.
        pauseGuardian: guardian && !guardian.guardian.equals(PublicKey.default) ? guardian.guardian : null,
      };
    },

    // The dispute PDA is reused when a dispute is raised again, so match the decision hash we proposed.
    async findDisputeResolution(spotAddress, decisionHash) {
      const dispute = pdas(program.programId).dispute(new PublicKey(spotAddress));
      const signatures = await connection.getSignaturesForAddress(dispute, { limit: 25 }, "confirmed");
      for (const { signature, err } of signatures) {
        if (err) continue;
        const event = await readTxEvent(signature, "DisputeResolved");
        const hash = event ? (event.decisionHash ?? event.decision_hash) : undefined;
        if (Array.isArray(hash) && Buffer.from(hash as number[]).toString("hex") === decisionHash) return { signature, event: event! };
      }
      return null;
    },

    // The program snapshots the timeout on each DisputeRecord, so later config changes don't move it.
    async readDisputeDeadlines(spotAddresses) {
      const out: Array<Date | null> = [];
      for (let start = 0; start < spotAddresses.length; start += 100) {
        const keys = spotAddresses.slice(start, start + 100).map((address) => pdas(program.programId).dispute(new PublicKey(address)));
        const records = await program.account.disputeRecord.fetchMultiple(keys);
        out.push(...records.map((record) => (record ? new Date((record.openedAt.toNumber() + record.timeoutSeconds.toNumber()) * 1000) : null)));
      }
      return out;
    },

    async readDisputeTimeoutSeconds() {
      const config = await program.account.config.fetch(pdas(program.programId).config());
      return config.disputeTimeoutSeconds.toNumber();
    },
  };
}
