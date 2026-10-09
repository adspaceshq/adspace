import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { WalletView } from "@/components/wallet/WalletView";

export const metadata: Metadata = { title: "wallet", robots: { index: false } };

export default function WalletPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see your wallet">
        <WalletView />
      </AuthGate>
    </AppShell>
  );
}
