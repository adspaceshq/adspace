"use client";

import { AlertTriangle } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppShell>
      <EmptyState
        icon={AlertTriangle}
        title="something went wrong"
        description={
          <>
            funds held in escrow are not affected. try again, or come back in a minute. still stuck?{" "}
            <a href="mailto:support@adspaces.fun" className="font-medium text-ink underline">
              contact support
            </a>
          </>
        }
        action={<Button onClick={reset}>try again</Button>}
      />
    </AppShell>
  );
}
