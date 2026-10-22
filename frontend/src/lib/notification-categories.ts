import type { NotificationCategory } from "@/lib/api/types";

// Email categories a user can turn off, as settings and the unsubscribe page name them.
export const NOTIFICATION_CATEGORIES: Array<{ id: NotificationCategory; label: string; description: string }> = [
  { id: "sales", label: "sales", description: "someone claims one of your spots" },
  { id: "bidding", label: "bidding", description: "you're outbid on a spot" },
  { id: "delivery", label: "delivery", description: "proof posted, proof due soon, review window closing" },
  { id: "disputes", label: "disputes", description: "a dispute opens, is withdrawn or decided" },
  { id: "payments", label: "payments", description: "payouts and refunds land in your wallet" },
  { id: "listings", label: "listing review", description: "your listing is approved or needs changes" },
  { id: "messages", label: "messages", description: "new messages in a spot thread (at most hourly)" },
  { id: "reminders", label: "saved listings", description: "a listing you saved closes within a day" },
];
