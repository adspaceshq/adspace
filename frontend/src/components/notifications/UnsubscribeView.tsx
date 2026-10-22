"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing, MailX } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { UnsubscribeState } from "@/lib/api/types";
import { NOTIFICATION_CATEGORIES } from "@/lib/notification-categories";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";

// Opened from the footer link in an email. Unsubscribing takes a click here (not on load), so link
// scanners that open every URL in an email never turn anything off. Mail clients use the one-click header.
export function UnsubscribeView() {
  const token = useSearchParams().get("token") ?? "";
  const queryClient = useQueryClient();
  const key = ["unsubscribe", token];
  const status = useQuery({ queryKey: key, queryFn: () => api.email.unsubscribeStatus(token), enabled: Boolean(token), retry: false });
  const change = useMutation({
    mutationFn: (subscribe: boolean) => (subscribe ? api.email.resubscribe(token) : api.email.unsubscribe(token)),
    onSuccess: (next: UnsubscribeState) => queryClient.setQueryData(key, next),
  });

  if (!token || status.isError) {
    return (
      <EmptyState
        icon={MailX}
        title="this link doesn't work"
        description="it may be cut off or from an old email. you can change which emails you get in settings."
        action={
          <Link href="/settings#notifications" className="text-body font-medium text-accent hover:underline">
            email settings
          </Link>
        }
      />
    );
  }
  if (!status.data) return <Skeleton className="h-56 w-full rounded-card" />;

  const { category, subscribed } = status.data;
  const info = NOTIFICATION_CATEGORIES.find((entry) => entry.id === category);
  const label = info?.label ?? category;
  const Icon = subscribed ? BellRing : BellOff;
  return (
    <Card className="flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Icon className="size-6" aria-hidden />
      </span>
      <div className="max-w-sm">
        <h1 className="text-title font-semibold">{subscribed ? `stop ${label} emails?` : `you're unsubscribed from ${label} emails`}</h1>
        <p className="mt-2 text-body text-muted">
          {subscribed
            ? `these are the emails sent when ${info?.description ?? "this happens"}. you'll still see them in the app.`
            : "you'll still see these in the app, and other emails, like support replies, keep coming."}
        </p>
      </div>
      <div aria-live="polite" className="flex flex-col items-center gap-3">
        {subscribed ? (
          <Button loading={change.isPending} onClick={() => change.mutate(false)}>
            unsubscribe
          </Button>
        ) : (
          <Button variant="secondary" loading={change.isPending} onClick={() => change.mutate(true)}>
            undo, keep sending them
          </Button>
        )}
        {change.isError && <p className="text-small text-danger">that didn&apos;t work. try again in a moment.</p>}
        <Link href="/settings#notifications" className="text-small font-medium text-accent hover:underline">
          choose all your email settings
        </Link>
      </div>
    </Card>
  );
}
