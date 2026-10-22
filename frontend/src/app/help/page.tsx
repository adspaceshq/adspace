import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { HelpView } from "@/components/help/HelpView";

export const metadata: Metadata = {
  title: "help",
  description: "answers to common questions about adspaces, and a way to reach the team.",
};

export default function HelpPage() {
  return (
    <AppShell variant="public">
      <Suspense>
        <HelpView />
      </Suspense>
    </AppShell>
  );
}
