import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { HomeView } from "@/components/dashboard/HomeView";

export const metadata: Metadata = { title: "home", robots: { index: false } };

// The signed-in start page: both sides at a glance. "as creator" and "as sponsor" hold the detail.
export default function DashboardHomePage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your home">
        <HomeView />
      </AuthGate>
    </AppShell>
  );
}
