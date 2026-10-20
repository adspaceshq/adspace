"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { profileHref } from "@/lib/listing-display";

const clean = (handle: string) => handle.trim().replace(/^@+/, "");

// "@handle", linking to that user's public profile. Inside another link or button (cards, search
// results) pass `nested`: it renders a span that navigates on its own without triggering the parent.
export function UserLink({ handle, nested = false, className = "" }: { handle: string; nested?: boolean; className?: string }) {
  const router = useRouter();
  const name = clean(handle);
  const href = profileHref(name);
  const style = `hover:text-accent hover:underline ${className}`;
  if (!nested) {
    return (
      <Link href={href} className={style}>
        @{name}
      </Link>
    );
  }
  const go = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
    router.push(href);
  };
  return (
    <span
      role="link"
      tabIndex={0}
      onClick={go}
      onKeyDown={(event) => (event.key === "Enter" ? go(event) : undefined)}
      className={`cursor-pointer ${style}`}
    >
      @{name}
    </span>
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
