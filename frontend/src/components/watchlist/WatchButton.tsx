"use client";

import { Bookmark } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { useWatchlist } from "@/lib/use-watchlist";

export function WatchButton({ listingId, sellerId, className = "" }: { listingId: string; sellerId: string; className?: string }) {
  const { session, signIn } = useSession();
  const { ids, toggle, enabled } = useWatchlist();
  const router = useRouter();
  if (session?.id === sellerId) return null;
  const pending = toggle.isPending && toggle.variables?.listingId === listingId;
  const watching = pending ? toggle.variables!.watching : ids.has(listingId);
  const onClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!session) return signIn();
    if (!enabled) return router.push("/onboarding");
    toggle.mutate({ listingId, watching: !watching });
  };
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={watching}
      aria-label={watching ? "remove from saved" : "save listing"}
      className={`cursor-pointer rounded-full bg-surface/90 p-2 shadow-card backdrop-blur transition-colors hover:bg-surface ${watching ? "text-accent" : "text-muted hover:text-ink"} ${className}`}
    >
      <Bookmark className="size-4" fill={watching ? "currentColor" : "none"} />
    </button>
  );
}
