import Link from "next/link";
import { ADSPACES_CLUSTER, IS_TEST_CLUSTER } from "@/lib/chain-config";
import { cx } from "@/lib/cx";

// Test money must never be mistaken for real money. Renders nothing on mainnet.
export function DevnetBanner({ variant = "bar", className }: { variant?: "bar" | "inline"; className?: string }) {
  if (!IS_TEST_CLUSTER) return null;
  if (variant === "inline") {
    return (
      <p className={cx("rounded-control bg-warning-soft px-3 py-2 text-small text-ink", className)}>
        <span className="font-semibold">{ADSPACES_CLUSTER}:</span> test usdc only, no real money.
      </p>
    );
  }
  return (
    <div role="note" aria-label={`${ADSPACES_CLUSTER} notice`} className={cx("border-b border-warning/20 bg-warning-soft text-ink", className)}>
      <p className="mx-auto max-w-7xl truncate px-4 py-1 text-center text-caption sm:px-6">
        <span className="font-semibold">{ADSPACES_CLUSTER}:</span> test usdc only, no real money.{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-muted">
          terms
        </Link>
      </p>
    </div>
  );
}
