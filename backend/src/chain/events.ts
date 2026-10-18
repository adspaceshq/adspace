import { BorshCoder, type Idl } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import type { AdspacesProgram } from "./program.js";

export type TxEventReader = (signature: string, name: string) => Promise<Record<string, unknown> | null>;

// Reads one of our program's events from a confirmed transaction's logs, so settlement rows can
// record what the program actually moved instead of a balance read made before sending.
export function txEventReader(connection: Connection, program: AdspacesProgram): TxEventReader {
  const coder = eventCoder(program.idl as Idl);
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

// Fields appended to events by later program versions. Transactions confirmed before an upgrade carry
// the shorter layout, which the current IDL cannot decode, so those events are read with the appended
// fields left out (readers treat them as missing).
// Keys are normalised (lower case, no underscores): Program converts its IDL to camelCase.
const APPENDED_EVENT_FIELDS: Record<string, string[]> = {
  disputeraised: ["evidenceuri", "timeoutseconds"],
  disputeresolved: ["decisionuri", "decidedat"],
};
const normalise = (name: string) => name.replace(/_/g, "").toLowerCase();

export interface EventDecoder {
  events: { decode: (log: string) => { name: string; data: unknown } | null };
}

function legacyIdl(idl: Idl): Idl {
  const types = (idl.types ?? []).map((type) => {
    const appended = APPENDED_EVENT_FIELDS[normalise(type.name)];
    if (!appended || type.type.kind !== "struct" || !Array.isArray(type.type.fields)) return type;
    const fields = (type.type.fields as Array<{ name: string }>).filter((field) => !appended.includes(normalise(field.name)));
    return { ...type, type: { ...type.type, fields } } as typeof type;
  });
  return { ...idl, types };
}

// Decodes events in the current layout, falling back to the layout before the appended fields.
// Never throws: an undecodable line is skipped instead of hiding the other events of the transaction.
export function eventCoder(idl: Idl): EventDecoder {
  const current = new BorshCoder(idl);
  const legacy = new BorshCoder(legacyIdl(idl));
  return {
    events: {
      decode(log) {
        try {
          const event = current.events.decode(log);
          if (event) return event;
        } catch {
          // Shorter, older layout: the legacy decoder below reads it.
        }
        try {
          return legacy.events.decode(log);
        } catch {
          return null;
        }
      },
    },
  };
}

// Anchor's EventParser misses events when our program runs as an inner instruction (for example
// when a Squads multisig executes it), so track the invoke stack ourselves and decode every
// "Program data:" line emitted while our program is the one running.
export function programEvents(logs: string[], programId: string, coder: EventDecoder) {
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

export function eventString(event: Record<string, unknown>, camel: string, snake: string): string | null {
  const value = event[camel] ?? event[snake];
  return typeof value === "string" ? value : null;
}
