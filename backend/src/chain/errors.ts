import { ADSPACES_IDL } from "./idl/adspaces.js";

const byCode = new Map<number, { name: string; msg?: string }>(
  ADSPACES_IDL.errors.map((error) => [error.code, { name: error.name, msg: error.msg }]),
);

export class ChainError extends Error {
  readonly status: number;
  constructor(message: string, readonly code?: number, readonly programError?: string, status = 409) {
    super(message);
    this.status = status;
  }
}

// Turns raw RPC/program failures into a message a user can act on.
export function decodeChainError(error: unknown, logs?: readonly string[] | null): ChainError {
  const text = [error instanceof Error ? error.message : JSON.stringify(error), ...(logs ?? [])].join("\n");
  const custom = /custom program error: 0x([0-9a-f]+)/i.exec(text) ?? /"Custom":\s*(\d+)/.exec(text);
  if (custom) {
    const code = custom[0].includes("0x") ? Number.parseInt(custom[1], 16) : Number(custom[1]);
    const known = byCode.get(code);
    if (known) return new ChainError(known.msg ?? known.name, code, known.name);
  }
  const anchor = /Error Code: (\w+)\. Error Number: (\d+)\. Error Message: ([^.]+)\./.exec(text);
  if (anchor) return new ChainError(anchor[3], Number(anchor[2]), anchor[1]);
  if (/insufficient (funds|lamports)/i.test(text)) return new ChainError("not enough balance to complete this transaction");
  if (/blockhash not found|block height exceeded/i.test(text)) {
    return new ChainError("the network took too long; please retry", undefined, undefined, 503);
  }
  return new ChainError("transaction failed on solana", undefined, undefined, 502);
}
