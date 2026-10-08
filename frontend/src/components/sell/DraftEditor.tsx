"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/v2";
import { fromOwnedListing } from "@/lib/sell-draft";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { SellWizard } from "./SellWizard";

export function DraftEditor({ listingId }: { listingId: string }) {
  const query = useQuery({ queryKey: ["me", "listing", listingId], queryFn: () => api.me.listing(listingId), staleTime: Infinity });
  if (query.isPending) {
    return (
      <SkeletonGroup label="loading draft">
        <Skeleton className="h-96 w-full" />
      </SkeletonGroup>
    );
  }
  if (query.isError) {
    return <EmptyState icon={AlertTriangle} title="draft not found" description={query.error.message} />;
  }
  const listing = query.data;
  if (listing.state !== "draft" && listing.state !== "changes_requested") {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="this listing can't be edited now"
        description="it's in review or already approved."
        action={
          <Link href={`/sell/listings/${listing.id}`} className="text-body font-medium text-accent hover:underline">
            open listing
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-6">
      {listing.state === "changes_requested" && listing.reviewNote && (
        <div role="note" className="rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-body">
          <p className="font-semibold">the reviewer asked for changes</p>
          <p className="text-muted">&ldquo;{listing.reviewNote}&rdquo;</p>
        </div>
      )}
      <SellWizard surface={listing.surface} listingId={listing.id} initial={fromOwnedListing(listing)} />
    </div>
  );
}
