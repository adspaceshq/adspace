"use client";

import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/chain-config";

export const shortKey = (value: string, chars = 4) => (value.length > chars * 2 + 1 ? `${value.slice(0, chars)}…${value.slice(-chars)}` : value);

// Any on-chain key or signature: shortened, full value on hover, copy button, optional explorer link.
export function Address({
  value,
  kind = "address",
  chars = 4,
  full = false,
  explorer = true,
  prefix,
  className = "",
}: {
  value: string;
  kind?: "address" | "tx";
  chars?: number;
  // Show the whole value (wrapping) instead of the shortened form.
  full?: boolean;
  explorer?: boolean;
  prefix?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const label = kind === "tx" ? "transaction" : "address";
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 ${className}`}>
      {/* JetBrains Mono runs ~15% larger than Inter at the same size; scale it down to sit level with the surrounding text. */}
      <span title={value} className={`font-mono text-[0.85em] tracking-tight ${full ? "no-scrollbar min-w-0 overflow-x-auto whitespace-nowrap" : "truncate"}`}>
        {prefix}
        {full ? value : shortKey(value, chars)}
      </span>
      <button
        type="button"
        onClick={(event) => void copy(event)}
        aria-label={copied ? `${label} copied` : `copy ${label}`}
        className="shrink-0 cursor-pointer rounded p-0.5 text-subtle hover:bg-ink/5 hover:text-ink"
      >
        {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </button>
      {explorer && (
        <a
          href={kind === "tx" ? explorerTxUrl(value) : explorerAddressUrl(value)}
          target="_blank"
          rel="noreferrer"
          aria-label={`view ${label} on explorer`}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 rounded p-0.5 text-subtle hover:bg-ink/5 hover:text-accent"
        >
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
    </span>
  );
}
