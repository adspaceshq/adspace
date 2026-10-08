import type { PrivyClient } from "@privy-io/node";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

export interface TxSigner {
  publicKey: PublicKey;
  sign(transaction: Transaction): Promise<Transaction>;
}

export function keypairSigner(keypair: Keypair): TxSigner {
  return {
    publicKey: keypair.publicKey,
    async sign(transaction) {
      transaction.partialSign(keypair);
      return transaction;
    },
  };
}

// Signs with a user's Privy embedded wallet through a delegated session signer.
export function privyWalletSigner(
  privy: PrivyClient,
  walletId: string,
  address: string,
  authorizationPrivateKey: string,
): TxSigner {
  return {
    publicKey: new PublicKey(address),
    async sign(transaction) {
      const { signed_transaction } = await privy.wallets().solana().signTransaction(walletId, {
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
        authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
      });
      return Transaction.from(Buffer.from(signed_transaction, "base64"));
    },
  };
}
