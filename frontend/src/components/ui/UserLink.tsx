"use client";

import Link from "next/link";
import { profileHref } from "@/lib/listing-display";

const clean = (handle: string) => handle.trim().replace(/^@+/, "");

// "@handle", linking to that user's public profile. Inside another link or button (cards, search
// results) pass `nested`: the card links with a stretched title link, and this one sits above it.
export function UserLink({ handle, nested = false, className = "" }: { handle: string; nested?: boolean; className?: string }) {
  const name = clean(handle);
  const href = profileHref(name);
  const style = `hover:text-accent hover:underline ${className}`;
  // Inside a card whose title link stretches over it, sit above that link so both stay clickable.
  return (
    <Link href={href} className={nested ? `relative z-10 ${style}` : style}>
      @{name}
    </Link>
  );
}

// Sponsor brand handles are X accounts, not adspaces users.
export function XHandleLink({ handle, className = "" }: { handle: string; className?: string }) {
  const name = clean(handle);
  return (
    <a href={`https://x.com/${encodeURIComponent(name)}`} target="_blank" rel="noreferrer nofollow" className={`hover:text-accent hover:underline ${className}`}>
      @{name}
    </a>
  );
}
