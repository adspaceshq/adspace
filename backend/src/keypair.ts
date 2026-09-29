import { readFileSync } from "node:fs";
import { Keypair } from "@solana/web3.js";

export function loadKeypair(secretOrPath: string): Keypair {
  const raw = secretOrPath.trim().startsWith("[")
    ? secretOrPath
    : readFileSync(secretOrPath, "utf8");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
}
