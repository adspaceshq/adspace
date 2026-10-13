import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { BrowseView } from "@/components/market/BrowseView";

export const metadata: Metadata = {
  title: "browse spaces",
  description: "Find ad space on laptops, cars, bags and more. Pay in USDC, held in escrow until delivery.",
};

export default function BrowsePage() {
  return (
    <AppShell>
      <Suspense>
        <BrowseView />
      </Suspense>
    </AppShell>
  );
}
