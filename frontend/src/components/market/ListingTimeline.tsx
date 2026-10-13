import type { PublicListing } from "@/lib/api/types";
import { Timeline, type TimelineStep } from "@/components/ui/Timeline";

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function ListingTimeline({ listing, now }: { listing: PublicListing; now: number }) {
  const deadline = new Date(listing.deadline).getTime();
  const delivery = new Date(listing.deliveryDueAt).getTime();
  const reviewHours = Math.round(listing.reviewWindowSeconds / 3600);
  const state = (start: number, end: number): TimelineStep["state"] => (now >= end ? "done" : now >= start ? "current" : "upcoming");
  const steps: TimelineStep[] = [
    { label: `${listing.mode === "auction" ? "bidding" : "claims"} close`, detail: day(listing.deadline), state: state(0, deadline) },
    { label: "creator delivers and posts proof", detail: `by ${day(listing.deliveryDueAt)}`, state: state(deadline, delivery) },
    {
      label: "sponsor review",
      detail: `${reviewHours}h to check delivery, then the creator is paid`,
      state: state(delivery, delivery + listing.reviewWindowSeconds * 1000),
    },
  ];
  return <Timeline steps={steps} />;
}
