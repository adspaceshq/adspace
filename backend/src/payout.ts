import type { SolanaCluster } from "./config.js";

const httpError = (message: string, status: number) => Object.assign(new Error(message), { status });

/** Solana transaction signatures are 64 raw bytes → 87–88 base58 chars. */
export function isSignatureLike(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(value);
}

/** Circle USDC mints. Override with USDC_MINT in env when needed. */
export function usdcMintFor(cluster: SolanaCluster, override?: string): string {
  if (override?.trim()) return override.trim();
  if (cluster === "mainnet-beta") return "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  return "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
}

export function explorerTxUrl(signature: string, cluster: SolanaCluster): string {
  const base = `https://explorer.solana.com/tx/${signature}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}

export interface PayoutVerifyInput {
  signature: string;
  /** Seller's payout wallet (base58). */
  destination: string;
  /** Net USDC owed to the seller (amount − fee), in display units. */
  expectedNet: number;
  cluster: SolanaCluster;
  rpcUrl: string;
  mint: string;
  fetchFn?: typeof fetch;
}

interface RpcTokenBalance {
  mint?: string;
  owner?: string;
  uiTokenAmount?: { uiAmount?: number | null; amount?: string; decimals?: number };
}

/**
 * Verify a USDC payout on-chain: confirmed tx whose post-balances credit
 * at least `expectedNet` USDC to `destination`. Throws 409 on mismatch.
 */
export async function verifyPayoutTx(input: PayoutVerifyInput): Promise<void> {
  const { signature, destination, expectedNet, cluster, rpcUrl, mint, fetchFn = fetch } = input;
  let res: Response;
  try {
    res = await fetchFn(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getTransaction",
        params: [signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }],
      }),
    });
  } catch {
    throw httpError("could not reach the Solana RPC to verify the payout", 503);
  }
  if (!res.ok) throw httpError("could not verify the payout transaction", 503);
  const body = (await res.json().catch(() => null)) as {
    result?: { meta?: { err?: unknown; preTokenBalances?: RpcTokenBalance[]; postTokenBalances?: RpcTokenBalance[] } } | null;
  } | null;
  const meta = body?.result?.meta;
  if (!meta) throw httpError("payout transaction not found (or not confirmed yet)", 409);
  if (meta.err) throw httpError("payout transaction failed on-chain", 409);

  const pre = new Map<string, number>();
  for (const b of meta.preTokenBalances ?? []) {
    if (b.mint === mint && b.owner === destination) {
      pre.set(`${b.owner}`, (pre.get(b.owner!) ?? 0) + (b.uiTokenAmount?.uiAmount ?? 0));
    }
  }
  let credited = 0;
  // Key token accounts by owner+mint via index alignment with pre balances is
  // unreliable; sum post minus pre per owner instead.
  const post = new Map<string, number>();
  for (const b of meta.postTokenBalances ?? []) {
    if (b.mint === mint && b.owner === destination) {
      post.set(b.owner!, (post.get(b.owner!) ?? 0) + (b.uiTokenAmount?.uiAmount ?? 0));
    }
  }
  credited = (post.get(destination) ?? 0) - (pre.get(destination) ?? 0);
  // 1-cent tolerance for rounding across wallets.
  if (!(credited + 0.01 >= expectedNet)) {
    throw httpError(
      `payout transaction does not credit ${expectedNet} USDC to ${destination} on ${cluster}`,
      409,
    );
  }
}

export interface PayoutReferenceInput {
  reference: string;
  destination: string;
  expectedNet: number;
  cluster?: SolanaCluster;
  rpcUrl?: string;
  mint?: string;
  fetchFn?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

/**
 * Manual-USDC rule: the pay `reference` is the Solana transfer signature.
 * Lenient by default (legacy memo refs still record, sig-like refs verify
 * when an RPC is configured) so existing tests and local dev keep working;
 * set PAYOUT_REQUIRE_ONCHAIN=1 to require a sig + on-chain verification.
 */
export async function resolvePayoutReference(input: PayoutReferenceInput): Promise<string> {
  const env = input.env ?? process.env;
  const note = (input.reference ?? "").trim();
  if (note.length > 200) throw httpError("reference must be at most 200 characters", 400);
  const strict = env.PAYOUT_REQUIRE_ONCHAIN === "1";
  const cluster: SolanaCluster =
    env.SOLANA_NETWORK === "mainnet-beta" || env.SOLANA_NETWORK === "testnet" ? env.SOLANA_NETWORK : "devnet";
  const rpcUrl = input.rpcUrl ?? env.SOLANA_RPC_URL ?? "";
  const mint = usdcMintFor(input.cluster ?? cluster, input.mint ?? env.USDC_MINT);

  if (strict && !isSignatureLike(note)) {
    throw httpError("reference must be the Solana payout transaction signature", 400);
  }
  if (isSignatureLike(note) && rpcUrl) {
    await verifyPayoutTx({
      signature: note,
      destination: input.destination,
      expectedNet: input.expectedNet,
      cluster: input.cluster ?? cluster,
      rpcUrl,
      mint,
      fetchFn: input.fetchFn,
    });
  }
  return note;
}
