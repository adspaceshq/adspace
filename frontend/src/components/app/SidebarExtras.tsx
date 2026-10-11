"use client";

import { useQuery } from "@tanstack/react-query";
import { LifeBuoy, Plus } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api/v2";
import type { NeedsYouItem } from "@/lib/api/types";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Countdown } from "@/components/ui/Countdown";
import { NEEDS_YOU_COPY } from "@/components/dashboard/NeedsYouList";

// The main creator action, X "post"-style.
export function NewListingButton() {
  return (
    <Link href="/sell" className="flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-body font-semibold text-white shadow-card transition-colors hover:bg-ink-soft">
      <Plus className="size-4" aria-hidden /> new listing
    </Link>
  );
}

const SHOWN = 3;

// The most urgent items from both dashboards, soonest deadline first.
export function NeedsYouMini() {
  const { session } = useSession();
  const enabled = Boolean(session?.onboarding);
  const creator = useQuery({ queryKey: queryKeys.creatorDashboard, queryFn: () => api.me.creatorDashboard(), enabled, refetchInterval: 60_000 });
  const sponsor = useQuery({ queryKey: queryKeys.sponsorDashboard, queryFn: () => api.me.sponsorDashboard(), enabled, refetchInterval: 60_000 });
  const items: NeedsYouItem[] = [...(creator.data?.needsYou ?? []), ...(sponsor.data?.needsYou ?? [])].sort(
    (a, b) => (a.dueAt ? Date.parse(a.dueAt) : Infinity) - (b.dueAt ? Date.parse(b.dueAt) : Infinity),
  );
  if (!enabled || items.length === 0) return null;

  return (
    <section aria-labelledby="sidebar-needs-you" className="flex flex-col gap-1 rounded-card border border-line bg-surface p-2 shadow-card">
      <h2 id="sidebar-needs-you" className="flex items-center justify-between px-2 pt-1 text-caption font-medium uppercase tracking-wide text-subtle">
        needs you
        <span className="rounded-full bg-ink px-1.5 text-[10px] font-semibold leading-4 text-white">{items.length}</span>
      </h2>
      <ul className="flex flex-col">
        {items.slice(0, SHOWN).map((item, index) => {
          const copy = NEEDS_YOU_COPY[item.type];
          const Icon = copy.icon;
          return (
            <li key={`${item.type}:${item.spotId ?? item.listingId}:${index}`}>
              <Link href={copy.href(item)} className="flex items-start gap-2 rounded-control px-2 py-1.5 hover:bg-ink/5">
                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${copy.tone}`}>
                  <Icon className="size-3" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-small text-ink">{copy.title(item)}</span>
                  <span className="block truncate text-caption text-muted">
                    {item.listingTitle}
                    {item.dueAt && (
                      <>
                        {" · "}
                        <Countdown to={item.dueAt} />
                      </>
                    )}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      {items.length > SHOWN && (
        <Link href="/dashboard" className="px-2 pb-1 text-caption font-medium text-accent hover:underline">
          see all {items.length}
        </Link>
      )}
    </section>
  );
}

// Test money must never be mistaken for real money.
export function NetworkBadge() {
  if (ADSPACES_CLUSTER === "mainnet-beta") return null;
  return (
    <p className="flex items-center gap-1.5 px-3 text-caption text-muted">
      <span className="size-1.5 rounded-full bg-warning" aria-hidden />
      {ADSPACES_CLUSTER} · test USDC only
    </p>
  );
}

// Same support address as the footer.
export function HelpLink() {
  return (
    <a href="mailto:support@adspaces.fun" className="flex items-center gap-2.5 rounded-control px-3 py-1.5 text-small text-muted hover:bg-ink/5 hover:text-ink">
      <LifeBuoy className="size-4" aria-hidden /> need help?
    </a>
  );
}
