import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { StaleSquadsProposal } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import { SQUADS_APP_URL } from "./SquadsPendingNote";

// Resolve proposals whose dispute was withdrawn or timed out. Executing one now fails on-chain
// (DisputeMismatch), so a multisig member should cancel it; it drops off once Squads shows it cancelled.
export function StaleProposals({ items, className, compact = false }: { items: StaleSquadsProposal[]; className?: string; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div role="status" className={cx("flex flex-col gap-2 rounded-card border border-warning/40 bg-warning-soft px-4 py-3", className)}>
      <p className="flex items-center gap-2 text-body font-medium">
        <AlertTriangle aria-hidden className="size-4 shrink-0 text-warning" />
        {items.length === 1 ? "a multisig proposal needs cancelling" : `${items.length} multisig proposals need cancelling`}
      </p>
      {!compact && (
        <p className="text-small text-muted">
          these decisions were proposed for disputes that closed another way. they can no longer execute; cancel them in Squads so nobody approves them by mistake.
        </p>
      )}
      <ul className="flex flex-col gap-1.5 text-small">
        {items.map((item) => (
          <li key={item.disputeId} className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium">{item.message}</span>
            <Link href={`/dashboard/spots/${item.spotId}`} className="text-muted hover:text-ink hover:underline">
              {item.listingTitle} · spot {item.spotIndex + 1}
            </Link>
            {item.status && <span className="text-caption text-subtle">squads: {item.status}</span>}
            <a href={SQUADS_APP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
              open #{item.transactionIndex} in Squads <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
