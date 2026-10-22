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

// Home is the overview of both sides; the creator and sponsor tabs hold the full detail of each.
export function DashboardHeader({ active, actions }: { active: "home" | "creator" | "sponsor"; actions?: React.ReactNode }) {
  const { session } = useSession();
  const now = useNow(60_000);
  const name = (session?.name ?? session?.handle ?? "").replace(/^@/, "").split(" ")[0];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-title font-semibold sm:text-display">
          {greeting(new Date(now).getHours())}
          {name ? `, ${name.toLowerCase()}` : ""}
        </h1>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      <Tabs
        active={active === "home" ? "/dashboard" : `/dashboard/${active}`}
        items={[
          { href: "/dashboard", label: "home" },
          { href: "/dashboard/creator", label: "as creator" },
          { href: "/dashboard/sponsor", label: "as sponsor" },
        ]}
      />
    </div>
  );
}
