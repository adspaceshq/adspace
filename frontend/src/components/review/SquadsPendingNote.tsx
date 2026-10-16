import { ExternalLink, Hourglass } from "lucide-react";
import { cx } from "@/lib/cx";

export const SQUADS_APP_URL = "https://backup.app.squads.so";

// The config authority is the Squads multisig: the server opened a proposal that members still approve and execute.
export function SquadsPendingNote({ index, url = SQUADS_APP_URL, children, className }: { index: number; url?: string; children?: React.ReactNode; className?: string }) {
  return (
    <div role="status" className={cx("flex items-start gap-3 rounded-control border border-warning/30 bg-warning-soft px-4 py-3", className)}>
      <Hourglass aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-body font-medium">waiting for multisig approval (Squads #{index})</p>
        {children && <p className="text-small text-muted">{children}</p>}
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-small font-medium text-accent hover:underline">
          open proposal #{index} in Squads <ExternalLink aria-hidden className="size-3.5" />
        </a>
      </div>
    </div>
  );
}
