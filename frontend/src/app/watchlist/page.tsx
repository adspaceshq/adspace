import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const metadata: Metadata = { title: "saved listings", robots: { index: false } };

export default function WatchlistPage() {
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to see saved listings">
        <WatchlistView />
      </AuthGate>
    </AppShell>
  );
}
