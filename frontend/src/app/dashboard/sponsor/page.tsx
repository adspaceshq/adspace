import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { SponsorDashboardView } from "@/components/dashboard/SponsorDashboardView";

export const metadata: Metadata = { title: "sponsor dashboard", robots: { index: false } };

export default function SponsorDashboardPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your sponsorships">
        <SponsorDashboardView />
      </AuthGate>
    </AppShell>
  );
}
