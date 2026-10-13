"use client";

import Link from "next/link";
import { Wallet } from "lucide-react";
import { Money } from "@/components/ui/Money";
import { useUsdcBalance } from "@/lib/use-balance";

export function WalletChip({ address }: { address?: string }) {
  const balance = useUsdcBalance(address);
  return (
    <Link
      href="/wallet"
      className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3 text-small font-medium text-ink transition-colors hover:border-line-strong"
      aria-label="wallet balance"
    >
      <Wallet className="size-4 text-muted" aria-hidden />
      {balance.isPending ? (
        <span className="h-3 w-12 animate-pulse rounded bg-ink/10" />
      ) : balance.data !== undefined ? (
        <Money value={balance.data} />
      ) : (
        <span title="couldn't load your balance" className="text-muted">
          –
        </span>
      )}
    </Link>
  );
}
