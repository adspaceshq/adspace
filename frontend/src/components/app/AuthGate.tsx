"use client";

import { Lock, ShieldAlert } from "lucide-react";
import { useAuthSession } from "@/components/AuthSessionProvider";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Single gate for every signed-in surface: loading, signed out, and not authorised.
export function AuthGate({
  children,
  requireReviewer = false,
  reason = "sign in to continue",
}: {
  children: React.ReactNode;
  requireReviewer?: boolean;
  reason?: string;
}) {
  const session = useAuthSession();

  if (!session.ready) {
    return (
      <SkeletonGroup label="loading your account">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </SkeletonGroup>
    );
  }

  if (!session.authenticated) {
    return (
      <EmptyState
        icon={Lock}
        title={reason}
        description="use x, google or email. a wallet is created for you automatically."
        action={<Button onClick={() => session.login()}>sign in</Button>}
      />
    );
  }

  if (requireReviewer && !session.isReviewer) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="reviewers only"
        description="this area is for the adspaces review team. if you think you should have access, contact support."
      />
    );
  }

  return <>{children}</>;
}
