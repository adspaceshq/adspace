import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { privy } from "./auth.js";
import type { SolanaCluster } from "./config.js";
import { usdcMintFor } from "./payout.js";
import type { SessionUser } from "./types.js";
import type { WalletWithdrawal } from "./withdrawals.js";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const caip2: Record<SolanaCluster, `solana:${string}`> = {
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
  testnet: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

function u64(value: bigint): Uint8Array {
  const data = new Uint8Array(8);
  new DataView(data.buffer).setBigUint64(0, value, true);
  return data;
}

export class PrivyWithdrawalSponsor {
  private connection: Connection;
  private mint: PublicKey;

  constructor(private rpcUrl: string, private cluster: SolanaCluster) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.mint = new PublicKey(usdcMintFor(cluster, process.env.USDC_MINT));
  }

  async send(user: SessionUser, withdrawal: WalletWithdrawal, userJwt: string): Promise<string> {
    if (!privy) throw Object.assign(new Error("Privy is not configured"), { status: 503 });
    if (!userJwt) throw Object.assign(new Error("fresh Privy authorization is required"), { status: 401 });
    const privyUser = await privy.users()._get(user.did);
    const wallet = privyUser.linked_accounts.find((account) =>
      account.type === "wallet"
      && account.chain_type === "solana"
      && account.address === withdrawal.source
      && account.wallet_client_type === "privy",
    );
    if (!wallet || !("id" in wallet) || !wallet.id) {
      throw Object.assign(new Error("Privy embedded wallet was not found"), { status: 409 });
    }
    if (!("delegated" in wallet) || !wallet.delegated) {
      throw Object.assign(new Error("Delegate the Privy wallet before withdrawing"), { status: 409 });
    }

    const owner = new PublicKey(withdrawal.source);
    const destination = new PublicKey(withdrawal.destination);
    const sourceAta = associatedTokenAddress(owner, this.mint);
    const destinationAta = associatedTokenAddress(destination, this.mint);
    const transaction = new Transaction();
    if (!(await this.connection.getAccountInfo(destinationAta, "confirmed"))) {
      transaction.add(new TransactionInstruction({
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        keys: [
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: destinationAta, isSigner: false, isWritable: true },
          { pubkey: destination, isSigner: false, isWritable: false },
          { pubkey: this.mint, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ],
        data: Buffer.from([1]),
      }));
    }
    const amount = BigInt(Math.round(withdrawal.amount * 1_000_000));
    transaction.add(new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: sourceAta, isSigner: false, isWritable: true },
        { pubkey: this.mint, isSigner: false, isWritable: false },
        { pubkey: destinationAta, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([12, ...u64(amount), 6]),
    }));
    const latest = await this.connection.getLatestBlockhash("confirmed");
    transaction.feePayer = owner;
    transaction.recentBlockhash = latest.blockhash;
    const result = await privy.wallets().solana().signAndSendTransaction(wallet.id, {
      transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
      caip2: caip2[this.cluster],
      sponsor: true,
      authorization_context: { user_jwts: [userJwt] },
    });
    return result.hash;
  }
}
