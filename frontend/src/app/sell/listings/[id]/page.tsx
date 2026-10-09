import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { ControlRoom } from "@/components/creator/ControlRoom";

export const metadata: Metadata = { title: "your listing", robots: { index: false } };

export default async function ControlRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to manage your listing">
        <Suspense>
          <ControlRoom listingId={id} />
        </Suspense>
      </AuthGate>
    </AppShell>
  );
}
