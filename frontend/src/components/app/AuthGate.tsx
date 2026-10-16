"use client";

import { CloudOff, Lock, MailCheck, ShieldAlert, UserRoundPen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

// Single gate for every signed-in surface: loading, signed out, email missing, not authorised.
//  lets a page render for any signed-in user, before email and onboarding are done
// (a sponsor's spot page: they may have paid before finishing setup and must always see what they bought).
export function AuthGate({
  children,
  require = "user",
  reason = "sign in to continue",
  setup = true,
}: {
  children: React.ReactNode;
  require?: "user" | "reviewer" | "admin";
  reason?: string;
  setup?: boolean;
}) {
  const { ready, session, signIn, loadError, refresh } = useSession();
  const pathname = usePathname();
  const setupHref = `/onboarding?next=${encodeURIComponent(pathname)}`;

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

  if (!session && loadError) {
    return (
      <EmptyState
        icon={CloudOff}
        title="couldn't reach adspaces"
        description="you're still signed in. check your connection and try again."
        action={<Button onClick={() => void refresh()}>try again</Button>}
      />
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

  if (setup && !session.emailVerified) {
    return (
      <EmptyState
        icon={MailCheck}
        title="verify your email to continue"
        description="we email you when you're outbid, when proof is due and when you get paid."
        action={
          <Link href={setupHref} className="text-body font-medium text-accent hover:underline">
            verify your email
          </Link>
        }
      />
    );
  }

  if (setup && !session.onboarding) {
    return (
      <EmptyState
        icon={UserRoundPen}
        title="finish setting up your account"
        description="pick a handle and tell us whether you sell space, sponsor, or both. it takes a minute."
        action={
          <Link href={setupHref} className="text-body font-medium text-accent hover:underline">
            continue setup
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
