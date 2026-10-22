import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { UnsubscribeView } from "@/components/notifications/UnsubscribeView";

export const metadata: Metadata = {
  title: "unsubscribe",
  // Every link carries a personal token; nothing here belongs in search results.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function UnsubscribePage() {
  return (
    <AppShell variant="public">
      <div className="mx-auto w-full max-w-md py-10">
        <Suspense>
          <UnsubscribeView />
        </Suspense>
      </div>
    </AppShell>
  );
}
