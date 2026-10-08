"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";

export function MessagesPanel({ spotId, counterpart }: { spotId: string; counterpart: string }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLOListElement>(null);

  const query = useQuery({
    queryKey: queryKeys.messages(spotId),
    queryFn: () => api.spots.messages(spotId),
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const send = useMutation({
    mutationFn: (body: string) => api.spots.sendMessage(spotId, body),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: queryKeys.messages(spotId) });
    },
  });
  const messages = query.data ?? [];

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  const submit = () => {
    const body = draft.trim();
    if (body && !send.isPending) send.mutate(body);
  };

  return (
    <section aria-labelledby="messages" className="flex flex-col gap-3">
      <h2 id="messages" className="text-lead font-semibold">
        messages with {counterpart}
      </h2>
      <ol ref={listRef} className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-card border border-line bg-canvas p-3">
        {query.isPending ? (
          <li className="text-small text-muted">loading…</li>
        ) : query.isError ? (
          <li className="text-small text-muted">messages open once the spot has a sponsor.</li>
        ) : messages.length === 0 ? (
          <li className="py-4 text-center text-small text-muted">say hi, share your logo files or placement notes.</li>
        ) : (
          messages.map((message) => {
            const mine = message.author.id === session?.id;
            return (
              <li key={message.id} className={cx("flex flex-col gap-0.5", mine ? "items-end" : "items-start")}>
                <p
                  className={cx(
                    "max-w-[85%] whitespace-pre-line rounded-card px-3 py-2 text-body",
                    mine ? "bg-ink text-white" : "border border-line bg-surface text-ink",
                  )}
                >
                  {message.body}
                </p>
                <span className="text-caption text-subtle">
                  {mine ? "you" : `@${message.author.handle}`} · {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            );
          })
        )}
      </ol>
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <label className="flex-1">
          <span className="sr-only">message</span>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={2}
            maxLength={2000}
            placeholder="write a message"
            className="w-full resize-none rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
          />
        </label>
        <Button type="submit" aria-label="send message" loading={send.isPending} disabled={!draft.trim()}>
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
      {send.isError && (
        <p role="alert" className="text-small text-danger">
          {send.error.message}
        </p>
      )}
    </section>
  );
}
