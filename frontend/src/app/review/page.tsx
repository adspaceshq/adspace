import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AuthGate } from "@/components/app/AuthGate";
import { ReviewQueue } from "@/components/review/ReviewQueue";

export const metadata: Metadata = { title: "review", robots: { index: false } };

export default function ReviewPage() {
  return (
    <AppShell variant="app">
      <AuthGate require="reviewer" reason="sign in to review">
        <Suspense>
          <ReviewQueue />
        </Suspense>
      </AuthGate>
    </AppShell>
  );
}
