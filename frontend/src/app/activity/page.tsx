import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { ActivityView } from "@/components/activity/ActivityView";

export const metadata: Metadata = { title: "activity", robots: { index: false } };

export default function ActivityPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your activity">
        <Suspense>
          <ActivityView />
        </Suspense>
      </AuthGate>
    </AppShell>
  );
}
