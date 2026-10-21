import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { MetricsView } from "@/components/review/MetricsView";

export const metadata: Metadata = { title: "metrics", robots: { index: false } };

export default function MetricsPage() {
  return (
    <AppShell variant="app">
      <AuthGate require="admin" reason="sign in to see metrics">
        <Suspense>
          <MetricsView />
        </Suspense>
      </AuthGate>
    </AppShell>
  );
}
