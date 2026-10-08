import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { ListingDecision } from "@/components/review/ListingDecision";

export const metadata: Metadata = { title: "review listing", robots: { index: false } };

export default async function ReviewListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell variant="app">
      <AuthGate require="reviewer" reason="sign in to review">
        <ListingDecision listingId={id} />
      </AuthGate>
    </AppShell>
  );
}
