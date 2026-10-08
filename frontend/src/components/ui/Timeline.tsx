import { Check } from "lucide-react";
import { cx } from "@/lib/cx";

export interface TimelineStep {
  label: string;
  detail?: React.ReactNode;
  state: "done" | "current" | "upcoming";
}

export function Timeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cx("flex flex-col", className)}>
      {steps.map((step, index) => (
        <li key={step.label} className="relative flex gap-3 pb-5 last:pb-0">
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className={cx(
                "absolute left-[11px] top-6 h-[calc(100%-1.25rem)] w-px",
                step.state === "done" ? "bg-ink" : "bg-line",
              )}
            />
          )}
          <span
            aria-hidden
            className={cx(
              "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-caption",
              step.state === "done" && "border-ink bg-ink text-white",
              step.state === "current" && "border-accent bg-accent-soft text-accent",
              step.state === "upcoming" && "border-line bg-surface text-subtle",
            )}
          >
            {step.state === "done" ? <Check className="size-3.5" /> : index + 1}
          </span>
          <div className="min-w-0 pt-0.5">
            <p
              aria-current={step.state === "current" ? "step" : undefined}
              className={cx("text-body font-medium", step.state === "upcoming" && "text-muted")}
            >
              {step.label}
            </p>
            {step.detail && <div className="mt-0.5 text-small text-muted">{step.detail}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}
