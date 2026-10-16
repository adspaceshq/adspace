"use client";

import { useState } from "react";
import { Zap } from "lucide-react";
import { userErrorMessage } from "@/lib/errors";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";

// Asked just in time, at the first money action, rather than during sign-up.
// `onBusyChange` lets a surrounding modal step aside while Privy's approval popup is open.
export function GaslessPrompt({ action, onBusyChange }: { action: string; onBusyChange?: (busy: boolean) => void }) {
  const { wallet } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const enable = async () => {
    setBusy(true);
    onBusyChange?.(true);
    setError(undefined);
    try {
      await wallet.enableGasless();
    } catch (cause) {
      setError(userErrorMessage(cause, "couldn't enable gasless transactions"));
    } finally {
      setBusy(false);
      onBusyChange?.(false);
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
