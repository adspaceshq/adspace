import type { Metadata } from "next";
import Link from "next/link";
import { Bike, Car, Laptop, Luggage, Monitor, Package, Shirt, type LucideIcon } from "lucide-react";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import type { Surface } from "@/lib/api/types";

export const metadata: Metadata = { title: "list your space" };

const SURFACES: Array<{ surface: Surface; label: string; hint: string; icon: LucideIcon }> = [
  { surface: "laptop", label: "laptop", hint: "lid stickers at conferences and cafes", icon: Laptop },
  { surface: "tshirt", label: "t-shirt", hint: "front and back, at events", icon: Shirt },
  { surface: "car", label: "car", hint: "doors, windows, bumper", icon: Car },
  { surface: "suitcase", label: "bag & suitcase", hint: "through airports and cities", icon: Luggage },
  { surface: "bike", label: "bike", hint: "frame and helmet", icon: Bike },
  { surface: "digital", label: "digital", hint: "banners, streams, newsletters", icon: Monitor },
  { surface: "other", label: "something else", hint: "anything people see", icon: Package },
];

export default function SellPage() {
  return (
    <AppShell variant="app">
      <PageHeader title="what are you listing?" description="pick a surface. you'll add photos, place spots and set prices next." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SURFACES.map((item) => (
          <Link
            key={item.surface}
            href={`/sell/new?surface=${item.surface}`}
            className="flex items-start gap-4 rounded-card border border-line bg-surface p-5 shadow-card transition-colors hover:border-ink"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-control bg-accent-soft text-accent">
              <item.icon className="size-5" aria-hidden />
            </span>
            <span>
              <span className="block text-body font-semibold">{item.label}</span>
              <span className="block text-small text-muted">{item.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
