import * as multisig from "@sqds/multisig";
import { PublicKey, TransactionMessage, type Connection, type TransactionInstruction } from "@solana/web3.js";
import type { TxSigner } from "./signers.js";

export type SquadsProposalStatus = "draft" | "active" | "rejected" | "approved" | "executing" | "executed" | "cancelled";

export interface SquadsProposal {
  multisig: PublicKey;
  transactionIndex: bigint;
  vaultTransaction: PublicKey;
  proposal: PublicKey;
  // vault_transaction_create + proposal_create, signed by the proposer (a member with Initiate only).
  instructions: TransactionInstruction[];
}

// Wraps instructions the config authority (the Squads vault) must sign into a vault transaction and
// opens a proposal for it. The proposer can only initiate: members approve and execute in the Squads app.
export interface SquadsProposer {
  multisig: PublicKey;
  // Vault index 0, the program's config authority.
  vault: PublicKey;
  proposer: TxSigner;
  propose: (instructions: TransactionInstruction[], memo: string) => Promise<SquadsProposal>;
  proposalStatus: (transactionIndex: bigint) => Promise<SquadsProposalStatus | null>;
}

export const SQUADS_VAULT_INDEX = 0;
export const SQUADS_APP_URL = "https://backup.app.squads.so";

// What the API returns for a proposal waiting on the multisig.
export interface SquadsPending {
  multisig: string;
  transactionIndex: number;
  vaultTransaction: string;
  proposal: string;
  url: string;
}

export function squadsPending(proposal: Omit<SquadsProposal, "instructions">): SquadsPending {
  return {
    multisig: proposal.multisig.toBase58(),
    transactionIndex: Number(proposal.transactionIndex),
    vaultTransaction: proposal.vaultTransaction.toBase58(),
    proposal: proposal.proposal.toBase58(),
    url: SQUADS_APP_URL,
  };
}

export function squadsVault(multisigPda: PublicKey): PublicKey {
  return multisig.getVaultPda({ multisigPda, index: SQUADS_VAULT_INDEX })[0];
}

// Pure instruction building; the transaction index is the multisig's current index + 1.
export function squadsProposalInstructions(input: {
  multisig: PublicKey;
  proposer: PublicKey;
  transactionIndex: bigint;
  instructions: TransactionInstruction[];
  memo?: string;
}): SquadsProposal {
  const vault = squadsVault(input.multisig);
  // Squads replaces the blockhash when it executes; any value is fine inside the vault message.
  const transactionMessage = new TransactionMessage({
    payerKey: vault,
    recentBlockhash: PublicKey.default.toBase58(),
    instructions: input.instructions,
  });
  const common = { multisigPda: input.multisig, transactionIndex: input.transactionIndex, creator: input.proposer, rentPayer: input.proposer };
  return {
    multisig: input.multisig,
    transactionIndex: input.transactionIndex,
    vaultTransaction: multisig.getTransactionPda({ multisigPda: input.multisig, index: input.transactionIndex })[0],
    proposal: multisig.getProposalPda({ multisigPda: input.multisig, transactionIndex: input.transactionIndex })[0],
    instructions: [
      multisig.instructions.vaultTransactionCreate({
        ...common,
        vaultIndex: SQUADS_VAULT_INDEX,
        ephemeralSigners: 0,
        transactionMessage,
        memo: input.memo,
      }),
      multisig.instructions.proposalCreate({ ...common, isDraft: false }),
    ],
  };
}

export function createSquadsProposer(connection: Connection, multisigAddress: PublicKey, proposer: TxSigner): SquadsProposer {
  return {
    multisig: multisigAddress,
    vault: squadsVault(multisigAddress),
    proposer,
    async propose(instructions, memo) {
      const account = await multisig.accounts.Multisig.fromAccountAddress(connection, multisigAddress, "confirmed");
      const transactionIndex = BigInt(account.transactionIndex.toString()) + 1n;
      return squadsProposalInstructions({ multisig: multisigAddress, proposer: proposer.publicKey, transactionIndex, instructions, memo });
    },
    async proposalStatus(transactionIndex) {
      const [address] = multisig.getProposalPda({ multisigPda: multisigAddress, transactionIndex });
      const info = await connection.getAccountInfo(address, "confirmed");
      if (!info) return null;
      const [proposal] = multisig.accounts.Proposal.fromAccountInfo(info);
      return proposal.status.__kind.toLowerCase() as SquadsProposalStatus;
    },
  };
}
