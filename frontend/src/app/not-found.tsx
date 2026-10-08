import Link from "next/link";
import { Compass } from "lucide-react";
import { AppShell } from "@/components/app/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";

export default function NotFound() {
  return (
    <AppShell>
      <EmptyState
        icon={Compass}
        title="this page doesn't exist"
        description="the listing may have closed or the link is wrong."
        action={
          <Link href="/browse" className="text-body font-medium text-accent hover:underline">
            browse open spaces
          </Link>
        }
      />
    </AppShell>
  );
}
