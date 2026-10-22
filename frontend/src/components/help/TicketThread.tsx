"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { SupportState, SupportTicket } from "@/lib/api/types";
import { cx } from "@/lib/cx";
import { userErrorMessage } from "@/lib/errors";
import { profileHref } from "@/lib/listing-display";
import { queryKeys } from "@/lib/query";
import type { WizardPhoto } from "@/lib/sell-draft";
import { Address } from "@/components/ui/Address";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { PhotoUploader } from "@/components/sell/PhotoUploader";
import { RichTextarea } from "@/components/ui/RichTextarea";
import { FormattedText } from "@/components/ui/FormattedText";

export const STATE_LABEL: Record<SupportState, { text: string; tone: BadgeTone }> = {
  open: { text: "waiting on the team", tone: "warning" },
  answered: { text: "answered", tone: "accent" },
  closed: { text: "closed", tone: "neutral" },
};

const when = (value: string) => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

// One support request and its replies. `staff` adds who asked and where they were, and replies as
// "adspaces team"; users see the same thread without the internal context.
export function TicketThread({ ticketId, staff = false }: { ticketId: string; staff?: boolean }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.supportTicket(ticketId), queryFn: () => api.support.ticket(ticketId), refetchInterval: 30_000 });
  const [reply, setReply] = useState("");
  const [shots, setShots] = useState<WizardPhoto[]>([]);
  const [uploading, setUploading] = useState(false);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.supportTicket(ticketId) }),
      queryClient.invalidateQueries({ queryKey: ["support"] }),
    ]);
  const send = useMutation({
    mutationFn: () => api.support.reply(ticketId, reply.trim(), shots.map((shot) => shot.assetId)),
    onSuccess: async () => {
      setReply("");
      setShots([]);
      await refresh();
    },
  });
  const close = useMutation({ mutationFn: () => api.support.close(ticketId), onSuccess: refresh });

  if (query.isPending) return <Skeleton className="h-64 w-full" />;
  if (query.isError) {
    return <EmptyState icon={AlertTriangle} title="couldn't open this request" description={userErrorMessage(query.error)} action={<Button onClick={() => void query.refetch()}>try again</Button>} />;
  }
  const ticket = query.data;
  const state = STATE_LABEL[ticket.state];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lead font-semibold">{ticket.subject}</h2>
          <p className="text-small text-muted">
            {ticket.topic} · opened {when(ticket.createdAt)}
          </p>
        </div>
        <Badge tone={state.tone}>{state.text}</Badge>
      </header>

      {staff && <ContextPanel ticket={ticket} />}

      <ol className="flex flex-col gap-3">
        {ticket.messages.map((message) => (
          <li
            key={message.id}
            className={cx("flex flex-col gap-2 rounded-card border p-4", message.fromStaff ? "border-accent/30 bg-accent-soft/50" : "border-line bg-surface")}
          >
            <p className="text-small font-medium text-muted">
              {message.fromStaff ? "adspaces team" : staff ? `@${ticket.user?.handle ?? "user"}` : "you"} · {when(message.createdAt)}
            </p>
            <FormattedText text={message.body} className="text-body" />
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {message.attachments.map((url) => (
                  <a key={url} href={url} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-control border border-line">
                    {/* eslint-disable-next-line @next/next/no-img-element -- screenshot thumbnail */}
                    <img src={url} alt="attached screenshot" className="size-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
        <RichTextarea
          label={staff ? "reply as the adspaces team" : ticket.state === "closed" ? "reply to reopen this request" : "reply"}
          rows={3}
          maxLength={4000}
          value={reply}
          onChange={setReply}
        />
        {!staff && <PhotoUploader photos={shots} onChange={setShots} kind="support" max={4} cover={false} addLabel="add screenshots" onUploadingChange={setUploading} />}
        {(send.isError || close.isError) && (
          <p role="alert" className="text-small text-danger">
            {userErrorMessage(send.error ?? close.error, "couldn't save that; try again")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => send.mutate()} loading={send.isPending} disabled={!reply.trim() || uploading}>
            send reply
          </Button>
          {ticket.state !== "closed" && (
            <Button variant="ghost" onClick={() => close.mutate()} loading={close.isPending}>
              {staff ? "close request" : "mark as solved"}
            </Button>
          )}
        </div>
        {staff && <p className="text-caption text-muted">the user gets your reply by email and in the app.</p>}
      </div>
    </div>
  );
}

// What the team sees about the request: who asked and where they were when they asked.
function ContextPanel({ ticket }: { ticket: SupportTicket }) {
  const context = ticket.context ?? {};
  const rows: Array<[string, React.ReactNode]> = [];
  if (ticket.user) {
    rows.push([
      "from",
      <Link key="user" href={profileHref(ticket.user.handle)} className="text-accent hover:underline">
        @{ticket.user.handle}
      </Link>,
    ]);
    if (ticket.user.email) rows.push(["email", ticket.user.email]);
    if (ticket.user.walletAddress) rows.push(["wallet", <Address key="wallet" value={ticket.user.walletAddress} />]);
  }
  if (context.page)
    rows.push([
      "page",
      <Link key="page" href={context.page} className="break-all text-accent hover:underline">
        {context.page}
      </Link>,
    ]);
  if (context.spotId)
    rows.push([
      "spot",
      <Link key="spot" href={`/dashboard/spots/${context.spotId}`} className="text-accent hover:underline">
        open the spot
      </Link>,
    ]);
  if (context.listingId)
    rows.push([
      "listing",
      <Link key="listing" href={`/review/ledger?listing=${context.listingId}`} className="text-accent hover:underline">
        open its ledger
      </Link>,
    ]);
  if (context.failedTx)
    rows.push([
      "last failed tx",
      <span key="tx" className="flex flex-col gap-0.5">
        <span>
          {context.failedTx.op.replaceAll("_", " ")} · {when(context.failedTx.at)}
        </span>
        {context.failedTx.error && <span className="break-words font-mono text-caption">{context.failedTx.error}</span>}
        {context.failedTx.signature && <Address value={context.failedTx.signature} kind="tx" />}
      </span>,
    ]);
  if (context.userAgent) rows.push(["device", <span key="ua" className="break-words text-caption">{context.userAgent}</span>]);
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-2 rounded-card border border-line bg-canvas p-4 text-small sm:grid-cols-[8rem_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted">{label}</dt>
          <dd className="min-w-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
