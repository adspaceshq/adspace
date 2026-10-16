"use client";

import { useCallback, useRef, useState } from "react";
import type { TxState } from "@/components/ui/TxStatus";
import { userErrorMessage } from "@/lib/errors";

// Drives TxStatus for backend-relayed actions: the server signs via Privy and returns the signature.
export function useTx<Args extends unknown[], Result extends { signature?: string } = { signature?: string }>(run: (...args: Args) => Promise<Result>) {
  const [state, setState] = useState<TxState>({ phase: "idle" });
  const lastArgs = useRef<Args | null>(null);

  const execute = useCallback(
    async (...args: Args) => {
      lastArgs.current = args;
      setState({ phase: "submitted" });
      try {
        const result = await run(...args);
        setState({ phase: "confirmed", signature: result.signature });
        return result;
      } catch (error) {
        setState({ phase: "failed", error: userErrorMessage(error) });
        return undefined;
      }
    },
    [run],
  );

  const retry = useCallback(() => {
    if (lastArgs.current) void execute(...lastArgs.current);
  }, [execute]);

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  return { state, execute, retry, reset, busy: state.phase === "signing" || state.phase === "submitted" };
}
