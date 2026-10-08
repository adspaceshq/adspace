"use client";

import { Lock, MailCheck, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Single gate for every signed-in surface: loading, signed out, email missing, not authorised.
export function AuthGate({
  children,
  require = "user",
  reason = "sign in to continue",
}: {
  children: React.ReactNode;
  require?: "user" | "reviewer" | "admin";
  reason?: string;
}) {
  const { ready, session, signIn } = useSession();

  if (!ready) {
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

  if (!session) {
    return (
      <EmptyState
        icon={Lock}
        title={reason}
        description="use x, google or email. a wallet is created for you automatically."
        action={<Button onClick={signIn}>sign in</Button>}
      />
    );
  }

  if (!session.email) {
    return (
      <EmptyState
        icon={MailCheck}
        title="verify your email to continue"
        description="we email you when you're outbid, when proof is due and when you get paid."
        action={
          <Link href="/onboarding" className="text-body font-medium text-accent hover:underline">
            add your email
          </Link>
        }
      />
    );
  }

  if ((require === "reviewer" && !session.isReviewer && !session.isAdmin) || (require === "admin" && !session.isAdmin)) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title={require === "admin" ? "admins only" : "reviewers only"}
        description="this area is for the adspaces team. if you think you should have access, contact support."
      />
    );
  }

  return <>{children}</>;
}
