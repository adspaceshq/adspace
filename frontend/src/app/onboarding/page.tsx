import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export const metadata: Metadata = { title: "set up your account", robots: { index: false } };

export default function OnboardingPage() {
  return (
    <AppShell variant="app">
      <Suspense>
        <OnboardingFlow />
      </Suspense>
    </AppShell>
  );
}
