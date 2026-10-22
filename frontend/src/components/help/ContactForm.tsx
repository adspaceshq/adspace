"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api/v2";
import type { SupportTopic } from "@/lib/api/types";
import { userErrorMessage } from "@/lib/errors";
import { queryKeys } from "@/lib/query";
import type { WizardPhoto } from "@/lib/sell-draft";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { PhotoUploader } from "@/components/sell/PhotoUploader";
import { useToast } from "@/components/ToastProvider";

const TOPICS: Array<{ value: SupportTopic; label: string }> = [
  { value: "buying", label: "sponsoring a spot" },
  { value: "selling", label: "selling a space" },
  { value: "payments", label: "wallet or payments" },
  { value: "disputes", label: "a dispute or refund" },
  { value: "account", label: "my account" },
  { value: "bug", label: "something isn't working" },
  { value: "other", label: "something else" },
];

export interface ContactContext {
  topic?: SupportTopic;
  page?: string;
  listingId?: string;
  spotId?: string;
}

// The support request form. Where the user came from (page, listing, spot) travels with it, and the
// server adds their latest failed transaction, so the team can help without asking.
export function ContactForm({ context, onSent }: { context: ContactContext; onSent: (ticketId: string) => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [topic, setTopic] = useState<SupportTopic | "">(context.topic ?? "");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [shots, setShots] = useState<WizardPhoto[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();

  const send = useMutation({
    mutationFn: () =>
      api.support.create({
        topic: topic as SupportTopic,
        subject: subject.trim(),
        message: message.trim(),
        attachmentIds: shots.map((shot) => shot.assetId),
        page: context.page,
        listingId: context.listingId,
        spotId: context.spotId,
      }),
    onSuccess: async (ticket) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.supportMine });
      toast.success("request sent", "we'll email you when the team replies, usually within a day.");
      onSent(ticket.id);
    },
  });

  const submit = () => {
    if (!topic) return setError("pick what it's about");
    if (subject.trim().length < 3) return setError("add a short subject");
    if (message.trim().length < 10) return setError("tell us a bit more (at least 10 characters)");
    if (uploading) return setError("wait for the screenshots to finish uploading");
    setError(undefined);
    send.mutate();
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-small font-medium">what&apos;s it about?</span>
        <select
          value={topic}
          onChange={(event) => setTopic(event.target.value as SupportTopic)}
          className="h-10 rounded-control border border-line bg-surface px-3 text-body focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        >
          <option value="" disabled>
            choose a topic
          </option>
          {TOPICS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <Input label="subject" placeholder="e.g. my payout hasn't arrived" value={subject} maxLength={120} onChange={(event) => setSubject(event.target.value)} />
      <Textarea
        label="message"
        hint="what happened, and what you expected. we already see which page you came from."
        rows={5}
        maxLength={4000}
        value={message}
        onChange={(event) => setMessage(event.target.value)}
      />
      <div className="flex flex-col gap-2">
        <p className="text-small font-medium">screenshots (optional)</p>
        <PhotoUploader
          photos={shots}
          onChange={setShots}
          kind="support"
          max={4}
          cover={false}
          addLabel="add screenshots"
          onUploadingChange={setUploading}
        />
      </div>
      {(error || send.isError) && (
        <p role="alert" className="text-small text-danger">
          {error ?? userErrorMessage(send.error, "couldn't send your request; try again")}
        </p>
      )}
      <Button onClick={submit} loading={send.isPending} className="self-start">
        send request
      </Button>
    </div>
  );
}
