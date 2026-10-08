"use client";

import { useQuery } from "@tanstack/react-query";
import { Connection, PublicKey } from "@solana/web3.js";
import { ADSPACES_USDC_MINT } from "@/lib/adspaces-program";
import { SOLANA_RPC_URL } from "@/lib/chain-config";

const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

let connection: Connection | undefined;

// Exact USDC balance in base units, read straight from the chain (0 if the account doesn't exist yet).
async function fetchBalance(owner: string): Promise<string> {
  connection ??= new Connection(SOLANA_RPC_URL, "confirmed");
  const [ata] = PublicKey.findProgramAddressSync(
    [new PublicKey(owner).toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), ADSPACES_USDC_MINT.toBuffer()],
    ATA_PROGRAM_ID,
  );
  if (!(await connection.getAccountInfo(ata, "confirmed"))) return "0";
  const { value } = await connection.getTokenAccountBalance(ata, "confirmed");
  return value.amount;
}

export function useUsdcBalance(owner: string | undefined) {
  return useQuery({
    queryKey: ["balance", owner],
    queryFn: () => fetchBalance(owner!),
    enabled: Boolean(owner),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });
}
