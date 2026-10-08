"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";

// Asked just in time, at the first money action, rather than during sign-up.
export function GaslessPrompt({ action }: { action: string }) {
  const { wallet } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const enable = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await wallet.enableGasless();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "couldn't enable gasless transactions");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Zap className="size-6" aria-hidden />
      </span>
      <div className="flex max-w-sm flex-col gap-1.5">
        <p className="text-lead font-semibold">one-time setup</p>
        <p className="text-body text-muted">
          to {action} without paying network fees, allow adspaces to submit transactions from your wallet. you still approve
          every purchase here, and you can turn this off anytime.
        </p>
      </div>
      <Button onClick={() => void enable()} loading={busy}>
        allow gasless transactions
      </Button>
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
