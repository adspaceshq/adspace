import Link from "next/link";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  Clock,
  FilePen,
  Gavel,
  RotateCcw,
  Upload,
  type LucideIcon,
} from "lucide-react";
import type { NeedsYouItem, NeedsYouType } from "@/lib/api/types";
import { listingHref } from "@/lib/listing-display";
import { Countdown } from "@/components/ui/Countdown";

interface Copy {
  icon: LucideIcon;
  tone: string;
  title: (item: NeedsYouItem) => string;
  cta: string;
  href: (item: NeedsYouItem) => string;
}

const spotLabel = (item: NeedsYouItem) => (item.spotIndex !== undefined ? `spot ${item.spotIndex + 1}` : "a spot");
const control = (item: NeedsYouItem) => `/sell/listings/${item.listingId}${item.spotId ? `?spot=${item.spotId}` : ""}`;
const sponsorSpot = (item: NeedsYouItem) => `/dashboard/spots/${item.spotId}`;

export const NEEDS_YOU_COPY: Record<NeedsYouType, Copy> = {
  proof_due: { icon: Upload, tone: "bg-accent-soft text-accent", title: (i) => `post proof for ${spotLabel(i)}`, cta: "add proof", href: control },
  accept_terms: { icon: BadgeCheck, tone: "bg-success-soft text-success", title: () => "your listing is approved", cta: "review & publish", href: (i) => `/sell/listings/${i.listingId}` },
  changes_requested: { icon: FilePen, tone: "bg-warning-soft text-warning", title: () => "the reviewer asked for changes", cta: "edit listing", href: (i) => `/sell/drafts/${i.listingId}` },
  dispute_open: { icon: AlertTriangle, tone: "bg-warning-soft text-warning", title: (i) => `a sponsor disputed ${spotLabel(i)}`, cta: "view", href: control },
  payout_ready: { icon: Banknote, tone: "bg-success-soft text-success", title: (i) => `payout ready for ${spotLabel(i)}`, cta: "get paid", href: control },
  review_proof: { icon: BadgeCheck, tone: "bg-accent-soft text-accent", title: (i) => `check delivery of ${spotLabel(i)}`, cta: "review", href: sponsorSpot },
  refund_available: { icon: RotateCcw, tone: "bg-warning-soft text-warning", title: (i) => `${spotLabel(i)} wasn't delivered`, cta: "get refund", href: sponsorSpot },
  outbid: { icon: Gavel, tone: "bg-danger-soft text-danger", title: (i) => `you were outbid on ${spotLabel(i)}`, cta: "bid again", href: (i) => listingHref(i.sellerHandle, i.listingSlug) },
  dispute_timeout_ready: { icon: Clock, tone: "bg-warning-soft text-warning", title: (i) => `dispute on ${spotLabel(i)} timed out`, cta: "get refund", href: sponsorSpot },
};

export function NeedsYouList({ items, emptyText }: { items: NeedsYouItem[]; emptyText: string }) {
  return (
    <section aria-labelledby="needs-you" className="flex flex-col gap-3">
      <h2 id="needs-you" className="flex items-center gap-2 text-lead font-semibold">
        needs you
        {items.length > 0 && (
          <span className="rounded-full bg-ink px-2 py-0.5 text-caption font-semibold text-white">{items.length}</span>
        )}
      </h2>
      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-card border border-line bg-surface px-4 py-4 text-body text-muted">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          {emptyText}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {items.map((item) => {
            const copy = NEEDS_YOU_COPY[item.type];
            return (
              <li key={`${item.type}:${item.spotId ?? item.listingId}`} className="flex items-center gap-3 px-4 py-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${copy.tone}`}>
                  <copy.icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium">{copy.title(item)}</p>
                  <p className="truncate text-small text-muted">
                    {item.listingTitle}
                    {item.dueAt && (
                      <>
                        {" · "}
                        <Countdown to={item.dueAt} prefix="due in" />
                      </>
                    )}
                  </p>
                </div>
                <Link
                  href={copy.href(item)}
                  className="shrink-0 rounded-control bg-ink px-3 py-1.5 text-small font-medium text-white hover:bg-ink-soft"
                >
                  {copy.cta}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
