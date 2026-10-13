"use client";

import { Check, Share2 } from "lucide-react";
import { useState } from "react";
import { listingHref } from "@/lib/listing-display";

const SHAREABLE = new Set(["funded", "delivered", "disputed", "settled"]);

// Public "sponsored by" link; its preview card shows the brand on the creator's item.
export function ShareSpotButton({ handle, slug, index, state, brandName }: { handle: string; slug: string; index: number; state: string; brandName?: string }) {
  const [copied, setCopied] = useState(false);
  if (!SHAREABLE.has(state) || !brandName) return null;
  const share = async () => {
    const url = `${window.location.origin}${listingHref(handle, slug)}/sponsored/${index + 1}`;
    if (navigator.share) {
      await navigator.share({ title: `${brandName} on adspaces`, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      type="button"
      onClick={() => void share()}
      className="inline-flex cursor-pointer items-center gap-1.5 self-start rounded-control border border-line px-3 py-1.5 text-small font-medium hover:border-line-strong"
    >
      {copied ? <Check className="size-4" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
      {copied ? "link copied" : "share your sponsorship"}
    </button>
  );
}
