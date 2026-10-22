"use client";

import { useSession, useSignedInHint } from "@/lib/session";
import { AppSidebar, BottomTabs } from "./AppNav";
import { SiteFooter } from "./SiteFooter";

// Public pages (browse, listings, profiles). Guests get the open layout with the full footer; anyone
// signed in gets the same sidebar and bottom tabs as the rest of the app, so their account is one click
// away on every page. The stored sign-in hint picks the frame before the session has loaded.
export function PublicFrame({ children, mobileTabs = true }: { children: React.ReactNode; mobileTabs?: boolean }) {
  const { ready, session } = useSession();
  const hinted = useSignedInHint();
  const signedIn = Boolean(session) || (!ready && hinted);

  if (!signedIn) {
    return (
      <>
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:py-10 lg:pb-24">
          {children}
        </main>
        <div className="lg:hidden">
          <SiteFooter bottomInset />
        </div>
      </>
    );
  }
  return (
    <>
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 sm:px-6">
        <AppSidebar />
        <main id="main" className="min-w-0 flex-1 py-8 pb-24 lg:pb-24">
          {children}
        </main>
      </div>
      <div className="lg:hidden">
        <SiteFooter bottomInset />
      </div>
      {mobileTabs && <BottomTabs />}
    </>
  );
}
