"use client";

import { useSession } from "@/lib/session";
import { useNow } from "@/lib/use-now";
import { Tabs } from "@/components/ui/Tabs";

function greeting(hour: number) {
  if (hour < 5) return "up late";
  if (hour < 12) return "good morning";
  if (hour < 18) return "good afternoon";
  return "good evening";
}

export function DashboardHeader({ active }: { active: "creator" | "sponsor" }) {
  const { session } = useSession();
  const now = useNow(60_000);
  const name = (session?.name ?? session?.handle ?? "").replace(/^@/, "").split(" ")[0];
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-title font-semibold sm:text-display">
        {greeting(new Date(now).getHours())}
        {name ? `, ${name.toLowerCase()}` : ""}
      </h1>
      <Tabs
        active={`/dashboard/${active}`}
        items={[
          { href: "/dashboard/creator", label: "as creator" },
          { href: "/dashboard/sponsor", label: "as sponsor" },
        ]}
      />
    </div>
  );
}
