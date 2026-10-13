import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { SettingsView } from "@/components/account/SettingsView";

export const metadata: Metadata = { title: "settings", robots: { index: false } };

export default function SettingsPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to manage your account">
        <SettingsView />
      </AuthGate>
    </AppShell>
  );
}
