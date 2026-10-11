import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { LedgerView } from "@/components/review/LedgerView";

export const metadata: Metadata = { title: "ledger", robots: { index: false } };

export default function LedgerPage() {
  return (
    <AppShell variant="app">
      <AuthGate require="reviewer" reason="sign in to review">
        <Suspense>
          <LedgerView />
        </Suspense>
      </AuthGate>
    </AppShell>
  );
}
