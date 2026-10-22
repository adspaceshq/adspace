"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, LifeBuoy } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SupportTopic } from "@/lib/api/types";
import { HELP_TOPICS } from "@/lib/help-guides";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ContactForm } from "./ContactForm";
import { HelpGuides } from "./HelpGuides";
import { STATE_LABEL, TicketThread } from "./TicketThread";

const TOPICS = new Set<string>(["buying", "selling", "payments", "disputes", "account", "bug", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Help: answers first (guides by topic), then a support request for anything they don't cover.
// Links elsewhere in the app can prefill it: /help?topic=bug&from=/wallet&spot=<id>#contact.
export function HelpView() {
  const params = useSearchParams();
  const router = useRouter();
  const { session, signIn } = useSession();
  const ticketId = params.get("ticket");
  const topic = params.get("topic");
  const listing = params.get("listing");
  const spot = params.get("spot");
  const context = {
    topic: topic && TOPICS.has(topic) ? (topic as SupportTopic) : undefined,
    page: params.get("from") ?? undefined,
    listingId: listing && UUID.test(listing) ? listing : undefined,
    spotId: spot && UUID.test(spot) ? spot : undefined,
  };

  if (ticketId && session) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <Link href="/help" className="inline-flex items-center gap-1.5 self-start text-small text-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden /> help
        </Link>
        <TicketThread ticketId={ticketId} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-title font-semibold sm:text-display">help</h1>
        <p className="text-body text-muted">answers to common questions, and a way to reach the team when they don&apos;t cover it.</p>
        <nav aria-label="help topics" className="mt-2 flex flex-wrap gap-2">
          {HELP_TOPICS.map((entry) => (
            <a key={entry.topic} href={`#${entry.topic}`} className="rounded-full border border-line bg-surface px-3 py-1.5 text-small font-medium hover:border-line-strong">
              {entry.label}
            </a>
          ))}
          <a href="#contact" className="rounded-full bg-ink px-3 py-1.5 text-small font-medium text-white hover:bg-ink-soft">
            contact us
          </a>
        </nav>
      </header>

      {session && <MyRequests />}

      <HelpGuides />

      <section id="contact" aria-labelledby="contact-title" className="flex scroll-mt-24 flex-col gap-4 rounded-panel border border-line bg-surface p-5 shadow-card">
        <div className="flex items-start gap-3">
          <LifeBuoy className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div>
            <h2 id="contact-title" className="text-lead font-semibold">
              still need help?
            </h2>
            <p className="text-small text-muted">send the team a request. we usually reply within a day, by email and here.</p>
          </div>
        </div>
        {session ? (
          <ContactForm context={context} onSent={(id) => router.push(`/help?ticket=${id}`)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={signIn}>sign in to contact us</Button>
            <span className="text-small text-muted">
              or email{" "}
              <a href="mailto:support@adspaces.fun" className="font-medium text-accent hover:underline">
                support@adspaces.fun
              </a>
            </span>
          </div>
        )}
      </section>
    </div>
  );
}

function MyRequests() {
  const query = useQuery({ queryKey: queryKeys.supportMine, queryFn: () => api.support.mine() });
  if (!query.data?.length) return null;
  return (
    <section aria-labelledby="my-requests" className="flex flex-col gap-3">
      <h2 id="my-requests" className="text-lead font-semibold">
        your requests
      </h2>
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {query.data.map((ticket) => (
          <li key={ticket.id}>
            <Link href={`/help?ticket=${ticket.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-ink/5">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body font-medium">{ticket.subject}</span>
                <span className="block text-small text-muted">updated {new Date(ticket.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
              </span>
              <Badge tone={STATE_LABEL[ticket.state].tone}>{STATE_LABEL[ticket.state].text}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
