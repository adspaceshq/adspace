import { BorshCoder, EventParser } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { AdspacesProgram } from "./program.js";

export type TxEventReader = (signature: string, name: string) => Promise<Record<string, unknown> | null>;

// Reads one of our program's events from a confirmed transaction's logs, so settlement rows can
// record what the program actually moved instead of a balance read made before sending.
export function txEventReader(connection: Connection, program: AdspacesProgram): TxEventReader {
  const parser = new EventParser(program.programId, new BorshCoder(program.idl));
  return async (signature, name) => {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = tx?.meta?.logMessages;
    if (!logs) return null;
    for (const event of parser.parseLogs(logs)) {
      if (event.name.toLowerCase() === name.toLowerCase()) return event.data as Record<string, unknown>;
    }
    return null;
  };
}

// Event fields come back camelCase or snake_case depending on the Anchor version.
export function eventAmount(event: Record<string, unknown>, camel: string, snake: string): bigint | null {
  const value = event[camel] ?? event[snake];
  if (value === undefined || value === null) return null;
  return BigInt(String(value));
}
