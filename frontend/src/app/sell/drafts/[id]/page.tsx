import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { DraftEditor } from "@/components/sell/DraftEditor";

export const metadata: Metadata = { title: "edit listing", robots: { index: false } };

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to edit your listing">
        <DraftEditor listingId={id} />
      </AuthGate>
    </AppShell>
  );
}
