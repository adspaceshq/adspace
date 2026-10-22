"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { HELP_GUIDES, HELP_TOPICS, type HelpGuide } from "@/lib/help-guides";

const topicLabel = Object.fromEntries(HELP_TOPICS.map((entry) => [entry.topic, entry.label]));
const matches = (guide: HelpGuide, words: string[]) => {
  const haystack = `${guide.question} ${guide.answer} ${topicLabel[guide.topic] ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
};

// The FAQ: grouped by topic, or one filtered list while searching. /help#<guide id> opens that answer.
export function HelpGuides() {
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const fromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (HELP_GUIDES.some((guide) => guide.id === id)) {
        setOpenId(id);
        requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
      }
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length ? HELP_GUIDES.filter((guide) => matches(guide, words)) : [];

  return (
    <div className="flex flex-col gap-8">
      <label className="relative block">
        <span className="sr-only">search help</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="search help, e.g. refund, withdraw, auction"
          className="h-12 w-full rounded-full border border-line bg-surface pl-12 pr-4 text-body shadow-card placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </label>

      {words.length > 0 ? (
        <section aria-live="polite" className="flex flex-col gap-3">
          <p className="text-small text-muted">
            {results.length === 0 ? "no answers match." : `${results.length} answer${results.length === 1 ? "" : "s"}`}{" "}
            {results.length === 0 && (
              <a href="#contact" className="font-medium text-accent hover:underline">
                ask the team instead
              </a>
            )}
          </p>
          {results.length > 0 && <GuideList guides={results} openId={openId} showTopic />}
        </section>
      ) : (
        HELP_TOPICS.map((entry) => (
          <section key={entry.topic} id={entry.topic} aria-labelledby={`${entry.topic}-title`} className="flex scroll-mt-24 flex-col gap-3">
            <div>
              <h2 id={`${entry.topic}-title`} className="text-lead font-semibold">
                {entry.label}
              </h2>
              <p className="text-small text-muted">{entry.description}</p>
            </div>
            <GuideList guides={HELP_GUIDES.filter((guide) => guide.topic === entry.topic)} openId={openId} />
          </section>
        ))
      )}
    </div>
  );
}

function GuideList({ guides, openId, showTopic = false }: { guides: HelpGuide[]; openId: string | null; showTopic?: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
      {guides.map((guide) => (
        <details key={guide.id} id={guide.id} open={guide.id === openId || undefined} className="group scroll-mt-24">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-body font-medium hover:bg-ink/5">
            <span>
              {showTopic && <span className="mr-2 text-small font-normal text-muted">{topicLabel[guide.topic]}</span>}
              {guide.question}
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted transition-transform group-open:rotate-90" aria-hidden />
          </summary>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <p className="text-body text-muted">{guide.answer}</p>
            {guide.links && (
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {guide.links.map((link) =>
                  link.href.startsWith("http") ? (
                    <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-small font-medium text-accent hover:underline">
                      {link.label} <ArrowUpRight className="size-3.5" aria-hidden />
                    </a>
                  ) : (
                    <Link key={link.href} href={link.href} className="text-small font-medium text-accent hover:underline">
                      {link.label}
                    </Link>
                  ),
                )}
              </div>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
