import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { NotificationsView } from "@/components/notifications/NotificationsView";

export const metadata: Metadata = { title: "notifications", robots: { index: false } };

export default function NotificationsPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see notifications">
        <NotificationsView />
      </AuthGate>
    </AppShell>
  );
}
