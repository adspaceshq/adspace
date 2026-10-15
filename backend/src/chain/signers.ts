import type { PrivyClient } from "@privy-io/node";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

export interface TxSigner {
  publicKey: PublicKey;
  sign(transaction: Transaction): Promise<Transaction>;
}

// Signers to pass next to the fee payer: drops the fee payer itself and repeats, so a
// platform key that is both fee payer and rent payer signs once.
export function cosigners(feePayer: TxSigner, ...signers: TxSigner[]): TxSigner[] {
  const out: TxSigner[] = [];
  for (const signer of signers) {
    if (signer.publicKey.equals(feePayer.publicKey) || out.some((seen) => seen.publicKey.equals(signer.publicKey))) continue;
    out.push(signer);
  }
  return out;
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
      try {
        const { signed_transaction } = await privy.wallets().solana().signTransaction(walletId, {
          transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
          authorization_context: { authorization_private_keys: [authorizationPrivateKey] },
        });
        return Transaction.from(Buffer.from(signed_transaction, "base64"));
      } catch (error) {
        throw signingError(error);
      }
    },
  };
}

// Privy rejects with 401 when the wallet hasn't authorized our key (e.g. after a key rotation).
// Surface that as a user-fixable 409 instead of a 401 the app would read as "signed out".
export function signingError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/authorization key|signing key|not authorized|key quorum/i.test(message)) {
    return Object.assign(new Error("gasless access needs to be reconnected: go to settings, security, and press reconnect"), { status: 409 });
  }
  if (/Invalid wallet authorization private key/i.test(message)) {
    return Object.assign(new Error("wallet signing isn't set up correctly on the server"), { status: 503 });
  }
  return error instanceof Error ? error : new Error(message);
}
