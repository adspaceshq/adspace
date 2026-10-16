"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, X } from "lucide-react";

// Shown once after the sell wizard submits a listing (it lands here with ?submitted=1).
export function SubmittedBanner() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  if (params.get("submitted") !== "1") return null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-card border border-success/30 bg-success-soft px-4 py-3">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold">submitted for review</p>
        <p className="text-small text-muted">the adspaces team usually responds within a day. we&apos;ll email you when it&apos;s decided.</p>
      </div>
      <button
        type="button"
        onClick={() => router.replace(pathname, { scroll: false })}
        aria-label="dismiss"
        className="cursor-pointer rounded-full p-1.5 text-muted hover:bg-ink/5 hover:text-ink"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
