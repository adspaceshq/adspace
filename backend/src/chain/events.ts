import { BorshCoder } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { AdspacesProgram } from "./program.js";

export type TxEventReader = (signature: string, name: string) => Promise<Record<string, unknown> | null>;

// Reads one of our program's events from a confirmed transaction's logs, so settlement rows can
// record what the program actually moved instead of a balance read made before sending.
export function txEventReader(connection: Connection, program: AdspacesProgram): TxEventReader {
  const coder = new BorshCoder(program.idl);
  const programId = program.programId.toBase58();
  return async (signature, name) => {
    const tx = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const logs = tx?.meta?.logMessages;
    if (!logs) return null;
    for (const event of programEvents(logs, programId, coder)) {
      if (event.name.toLowerCase() === name.toLowerCase()) return event.data as Record<string, unknown>;
    }
    return null;
  };
}

// Anchor's EventParser misses events when our program runs as an inner instruction (for example
// when a Squads multisig executes it), so track the invoke stack ourselves and decode every
// "Program data:" line emitted while our program is the one running.
export function programEvents(logs: string[], programId: string, coder: BorshCoder) {
  const events: { name: string; data: unknown }[] = [];
  const stack: string[] = [];
  for (const line of logs) {
    const invoke = /^Program (\S+) invoke \[\d+\]$/.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (/^Program \S+ (success|failed)/.test(line)) {
      stack.pop();
      continue;
    }
    if (stack[stack.length - 1] !== programId || !line.startsWith("Program data: ")) continue;
    const event = coder.events.decode(line.slice("Program data: ".length));
    if (event) events.push(event);
  }
  return events;
}

// Event fields come back camelCase or snake_case depending on the Anchor version.
export function eventAmount(event: Record<string, unknown>, camel: string, snake: string): bigint | null {
  const value = event[camel] ?? event[snake];
  if (value === undefined || value === null) return null;
  return BigInt(String(value));
}
