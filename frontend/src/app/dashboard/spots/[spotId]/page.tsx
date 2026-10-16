import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { SponsorSpotView } from "@/components/spot/SponsorSpotView";

export const metadata: Metadata = { title: "your spot", robots: { index: false } };

export default async function SponsorSpotPage({ params }: { params: Promise<{ spotId: string }> }) {
  const { spotId } = await params;
  return (
    <AppShell variant="app">
      {/* No setup gate: a sponsor who paid must always be able to see their spot. */}
      <AuthGate reason="sign in to see your spot" setup={false}>
        <SponsorSpotView spotId={spotId} />
      </AuthGate>
    </AppShell>
  );
}
