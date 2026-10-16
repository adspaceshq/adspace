import { AppShell } from "@/components/app/AppShell";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Shown while a listing loads on the server.
export default function ListingLoading() {
  return (
    <AppShell mobileTabs={false}>
      <SkeletonGroup label="loading listing">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="aspect-[4/3] w-full rounded-card" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-80 w-full rounded-panel" />
        </div>
      </SkeletonGroup>
    </AppShell>
  );
}
