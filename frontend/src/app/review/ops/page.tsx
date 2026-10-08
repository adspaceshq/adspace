import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { OpsPanel } from "@/components/review/OpsPanel";

export const metadata: Metadata = { title: "ops", robots: { index: false } };

export default function OpsPage() {
  return (
    <AppShell variant="app">
      <AuthGate require="reviewer" reason="sign in to review">
        <OpsPanel />
      </AuthGate>
    </AppShell>
  );
}
