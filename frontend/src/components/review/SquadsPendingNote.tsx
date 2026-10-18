"use client";

import { AlertTriangle, ExternalLink, Hourglass } from "lucide-react";
import { cx } from "@/lib/cx";
import { formatExpiry, proposalExpiry } from "@/lib/squads-expiry";
import { useNow } from "@/lib/use-now";

export const SQUADS_APP_URL = "https://backup.app.squads.so";

// The config authority is the Squads multisig: the server opened a proposal that members still approve and execute.
// `validUntil`: admin proposals expire on-chain; past it the proposal can't execute and must be rebuilt.
export function SquadsPendingNote({
  index,
  url = SQUADS_APP_URL,
  validUntil,
  children,
  className,
}: {
  index: number;
  url?: string;
  validUntil?: string | null;
  children?: React.ReactNode;
  className?: string;
}) {
  const now = useNow(30_000);
  const expiry = proposalExpiry(validUntil, now);
  const expired = Boolean(expiry?.expired);
  return (
    <div
      role="status"
      className={cx(
        "flex items-start gap-3 rounded-control border px-4 py-3",
        expired ? "border-danger/30 bg-danger-soft" : "border-warning/30 bg-warning-soft",
        className,
      )}
    >
      {expired ? (
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
      ) : (
        <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      )}
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body font-medium">{expired ? `Squads #${index} expired` : `waiting for multisig approval (Squads #${index})`}</p>
        {expired ? (
          <p className="text-small text-muted">
            it can no longer execute (it expired {formatExpiry(expiry!.at)}). rebuild it from the current settings, then cancel #{index} in Squads.
          </p>
        ) : (
          <>
            {children && <p className="text-small text-muted">{children}</p>}
            {expiry && <p className="text-small text-muted">expires {formatExpiry(expiry.at)}. after that it can&apos;t execute and has to be rebuilt.</p>}
          </>
        )}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-small font-medium text-accent hover:underline">
          open proposal #{index} in Squads <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
