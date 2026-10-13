import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { SellWizard } from "@/components/sell/SellWizard";
import type { Surface } from "@/lib/api/types";

export const metadata: Metadata = { title: "new listing", robots: { index: false } };

const SURFACES: Surface[] = ["laptop", "tshirt", "car", "suitcase", "bike", "digital", "other"];

export default async function NewListingPage({ searchParams }: { searchParams: Promise<{ surface?: string }> }) {
  const { surface } = await searchParams;
  if (!surface || !SURFACES.includes(surface as Surface)) redirect("/sell");
  return (
    <AppShell variant="app">
      <AuthGate reason="sign in to list your space">
        <SellWizard surface={surface as Surface} />
      </AuthGate>
    </AppShell>
  );
}
