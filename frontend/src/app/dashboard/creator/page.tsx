import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { CreatorDashboardView } from "@/components/dashboard/CreatorDashboardView";

export const metadata: Metadata = { title: "creator dashboard", robots: { index: false } };

export default function CreatorDashboardPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your listings">
        <CreatorDashboardView />
      </AuthGate>
    </AppShell>
  );
}
