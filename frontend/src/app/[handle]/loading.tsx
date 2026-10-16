import { AppShell } from "@/components/app/AppShell";
import { ListingCardSkeleton } from "@/components/market/ListingCard";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Shown while a profile loads on the server.
export default function ProfileLoading() {
  return (
    <AppShell>
      <SkeletonGroup label="loading profile">
        <div className="flex flex-col gap-8">
          <div className="flex items-center gap-4">
            <Skeleton className="size-20 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-20 w-full" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <ListingCardSkeleton key={index} />
            ))}
          </div>
        </div>
      </SkeletonGroup>
    </AppShell>
  );
}
