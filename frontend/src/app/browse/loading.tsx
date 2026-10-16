import { AppShell } from "@/components/app/AppShell";
import { ListingCardSkeleton } from "@/components/market/ListingCard";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Shown while page 1 of browse loads on the server.
export default function BrowseLoading() {
  return (
    <AppShell>
      <SkeletonGroup label="loading listings">
        <div className="flex flex-col gap-6">
          <Skeleton className="h-10 w-2/3 max-w-md" />
          <Skeleton className="h-12 w-full rounded-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }, (_, index) => (
              <ListingCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </SkeletonGroup>
    </AppShell>
  );
}
