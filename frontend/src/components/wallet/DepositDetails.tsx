"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { ADSPACES_CLUSTER } from "@/lib/chain-config";
import { Button } from "@/components/ui/Button";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked: the address is on screen to copy by hand.
    }
  };
  return (
    <Button variant="secondary" size="sm" onClick={() => void copy()} aria-label={label}>
      {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      {copied ? "copied" : "copy"}
    </Button>
  );
}

// How to add USDC: the deposit address with a copy button, plus the test faucet off mainnet.
// Used by the wallet page and inline in checkout when the balance falls short.
export function DepositDetails({ address }: { address: string }) {
  const test = ADSPACES_CLUSTER !== "mainnet-beta";
  return (
    <>
      <p className="text-small text-muted">send USDC on Solana to this address. other tokens or networks will be lost.</p>
      {test && (
        <p className="text-small text-muted">
          <span className="font-medium text-ink">{ADSPACES_CLUSTER} only.</span> don&apos;t send real (mainnet) USDC to this address.
        </p>
      )}
      <div className="flex items-center gap-2 rounded-control bg-canvas p-3">
        <code className="min-w-0 flex-1 break-all font-mono text-caption tracking-tight sm:text-small">{address}</code>
        <CopyButton value={address} label="copy deposit address" />
      </div>
      {test && (
        <p className="text-small text-muted">
          testing on {ADSPACES_CLUSTER}? get test USDC from the{" "}
          <a href="https://faucet.circle.com" target="_blank" rel="noreferrer" className="text-accent hover:underline">
            Circle faucet
          </a>
          .
        </p>
      )}
    </>
  );
}
