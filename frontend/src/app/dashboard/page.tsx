"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";
import { useSession } from "@/lib/session";

// Opens the view that matches what the user said they're here for at onboarding.
export default function DashboardIndexPage() {
  const { ready, session } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!ready || !session) return;
    router.replace(session.onboarding?.accountType === "creator" ? "/dashboard/creator" : "/dashboard/sponsor");
  }, [ready, session, router]);

  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your dashboard">
        <SkeletonGroup label="opening your dashboard">
          <Skeleton className="h-10 w-64" />
        </SkeletonGroup>
      </AuthGate>
    </AppShell>
  );
}
