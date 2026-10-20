import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { OnboardingFlow } from "@/components/onboarding/OnboardingFlow";

export const metadata: Metadata = { title: "set up your account", robots: { index: false } };

export default function OnboardingPage() {
  return (
    // Focused: no sidebar, every link of which would lead back to "finish setup".
    <AppShell variant="public" mobileTabs={false}>
      <Suspense>
        <OnboardingFlow />
      </Suspense>
    </AppShell>
  );
}
