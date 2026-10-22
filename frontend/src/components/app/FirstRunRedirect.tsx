"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { hasPendingCheckout, takeFreshSignIn } from "@/lib/first-run";
import { useSession } from "@/lib/session";

// Right after a sign-in by someone who hasn't set up their account, open setup. From a general page
// (browse) they land on home afterwards; from a specific listing or profile, back on that page.
// Skipped when they signed in to buy a spot (checkout handles them) or are already on a setup page.
export function FirstRunRedirect() {
  const { ready, session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (!ready || !session) return;
    if (!takeFreshSignIn()) return;
    if (session.onboarding || hasPendingCheckout() || pathname.startsWith("/onboarding")) return;
    if (pathname === "/" || pathname === "/browse") return router.replace("/onboarding");
    const query = search.toString();
    const here = query ? `${pathname}?${query}` : pathname;
    router.replace(`/onboarding?next=${encodeURIComponent(here)}`);
  }, [ready, session, pathname, search, router]);

  return null;
}
