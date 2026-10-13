"use client";

import { Check, RotateCcw } from "lucide-react";
import { MAC_COLORS, presetUrl, type MockupChoice } from "@/lib/mac-mockup";
import { cx } from "@/lib/cx";

export function MacMockupPicker({
  choice,
  onChange,
  replacing,
  error,
  onRetry,
  busy,
}: {
  choice: MockupChoice;
  onChange: (choice: MockupChoice) => void;
  // How many of the seller's own photos continuing with the mockup would replace.
  replacing: number;
  error?: string;
  onRetry: () => void;
  busy: boolean;
}) {
  const selected = MAC_COLORS.find((color) => color.id === choice.color) ?? MAC_COLORS[0];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-small text-muted" id="mac-colour-label">
          colour: <span className="font-medium text-ink">{selected.label}</span>
        </p>
        <div role="radiogroup" aria-labelledby="mac-colour-label" className="flex flex-wrap gap-2">
          {MAC_COLORS.map((color) => {
            const active = color.id === choice.color;
            return (
              <button
                key={color.id}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={color.label}
                title={color.label}
                disabled={busy}
                onClick={() => onChange({ ...choice, color: color.id })}
                className={cx(
                  "flex size-11 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed",
                  active ? "border-ink" : "border-transparent hover:border-line-strong",
                )}
              >
                <span className="flex size-8 items-center justify-center rounded-full border border-ink/15 shadow-card" style={{ backgroundColor: color.swatch }}>
                  {active && <Check className={cx("size-4", ["space-gray", "space-black", "midnight"].includes(color.id) ? "text-white" : "text-ink")} aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={cx("grid gap-3", choice.inside && "sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]")}>
        <figure className="relative flex aspect-[1484/1060] items-center justify-center overflow-hidden rounded-card border border-line bg-canvas p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- static Cloudinary preset, already transformed */}
          <img src={presetUrl(`lid-${choice.color}`, 1200)} alt={`MacBook lid in ${selected.label}`} className="size-full object-contain" />
          <figcaption className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-caption font-medium text-white">cover</figcaption>
        </figure>
        {choice.inside && (
          <figure className="relative flex aspect-[1402/1122] items-center justify-center overflow-hidden rounded-card border border-line bg-canvas p-3 sm:self-start">
            {/* eslint-disable-next-line @next/next/no-img-element -- static Cloudinary preset, already transformed */}
            <img src={presetUrl("inside", 600)} alt="open MacBook keyboard deck" className="size-full object-contain" />
            <figcaption className="absolute left-2 top-2 rounded-full bg-surface/90 px-2 py-0.5 text-caption font-medium shadow-card">keyboard deck</figcaption>
          </figure>
        )}
      </div>

      <label className="flex cursor-pointer items-center gap-2 text-body">
        <input
          type="checkbox"
          checked={choice.inside}
          disabled={busy}
          onChange={(event) => onChange({ ...choice, inside: event.target.checked })}
          className="size-4 accent-ink"
        />
        also sell spots on the keyboard deck
      </label>

      {replacing > 0 && (
        <p className="text-small text-muted">
          continuing with the mockup replaces your {replacing} uploaded photo{replacing === 1 ? "" : "s"}. switch to &quot;upload your own&quot; to keep {replacing === 1 ? "it" : "them"}.
        </p>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-card bg-danger-soft p-3 text-small text-danger">
          <span>{error}</span>
          <button type="button" onClick={onRetry} className="inline-flex cursor-pointer items-center gap-1 rounded-control bg-ink px-2.5 py-1 text-small text-white">
            <RotateCcw className="size-3.5" aria-hidden /> retry
          </button>
        </div>
      )}
    </div>
  );
}
