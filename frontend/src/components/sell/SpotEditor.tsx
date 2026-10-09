"use client";

import { useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { WizardSpot } from "@/lib/sell-draft";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

const MAX_SPOTS = 60;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type Drag = { key: string; mode: "move" | "resize"; startX: number; startY: number; origin: WizardSpot["layout"] };

export function SpotEditor({
  photoUrl,
  spots,
  onChange,
  errors,
}: {
  photoUrl: string;
  spots: WizardSpot[];
  onChange: (update: (current: WizardSpot[]) => WizardSpot[]) => void;
  errors: Partial<Record<string, string>>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selectedKey, setSelectedKey] = useState(spots[0]?.key);
  const [bulkPrice, setBulkPrice] = useState("");
  const selectedIndex = spots.findIndex((spot) => spot.key === selectedKey);
  const selected = spots[selectedIndex];

  const patch = (key: string, change: Partial<WizardSpot> | ((spot: WizardSpot) => Partial<WizardSpot>)) =>
    onChange((current) => current.map((spot) => (spot.key === key ? { ...spot, ...(typeof change === "function" ? change(spot) : change) } : spot)));

  const percent = (event: React.PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect();
    return { x: ((event.clientX - rect.left) / rect.width) * 100, y: ((event.clientY - rect.top) / rect.height) * 100 };
  };

  const begin = (event: React.PointerEvent, spot: WizardSpot, mode: Drag["mode"]) => {
    event.preventDefault();
    event.stopPropagation();
    (event.target as Element).setPointerCapture(event.pointerId);
    const point = percent(event);
    drag.current = { key: spot.key, mode, startX: point.x, startY: point.y, origin: spot.layout };
    setSelectedKey(spot.key);
  };

  const moveTo = (event: React.PointerEvent) => {
    const active = drag.current;
    if (!active) return;
    const point = percent(event);
    const dx = point.x - active.startX;
    const dy = point.y - active.startY;
    patch(active.key, (spot) =>
      active.mode === "move"
        ? { layout: { ...spot.layout, x: Math.round(clamp(active.origin.x + dx, 0, 100) * 10) / 10, y: Math.round(clamp(active.origin.y + dy, 0, 100) * 10) / 10 } }
        : { layout: { ...spot.layout, w: Math.round(clamp(active.origin.w + dx * 2, 4, 60) * 10) / 10 } },
    );
  };

  const nudge = (event: React.KeyboardEvent, spot: WizardSpot) => {
    const step = event.shiftKey ? 5 : 1;
    const delta: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const move = delta[event.key];
    if (move) {
      event.preventDefault();
      patch(spot.key, { layout: { ...spot.layout, x: clamp(spot.layout.x + move[0], 0, 100), y: clamp(spot.layout.y + move[1], 0, 100) } });
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      remove(spot.key);
    }
  };

  const add = (from?: WizardSpot) => {
    if (spots.length >= MAX_SPOTS) return;
    const spot: WizardSpot = from
      ? { ...from, key: crypto.randomUUID(), layout: { ...from.layout, x: clamp(from.layout.x + 6, 0, 100), y: clamp(from.layout.y + 6, 0, 100) } }
      : { key: crypto.randomUUID(), label: "", price: spots[0]?.price ?? "10", layout: { x: 50, y: 50, w: 15 } };
    onChange((current) => [...current, spot]);
    setSelectedKey(spot.key);
  };

  const remove = (key: string) => {
    const index = spots.findIndex((spot) => spot.key === key);
    onChange((current) => current.filter((spot) => spot.key !== key));
    setSelectedKey(spots[index + 1]?.key ?? spots[index - 1]?.key);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3">
        <div
          ref={frame}
          onPointerMove={moveTo}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className="relative aspect-[4/3] touch-none select-none overflow-hidden rounded-panel bg-ink/5"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- editor canvas needs the raw image size-independent */}
          <img src={photoUrl} alt="" draggable={false} className="pointer-events-none size-full object-cover" />
          {spots.map((spot, index) => {
            const active = spot.key === selectedKey;
            return (
              <div
                key={spot.key}
                role="button"
                tabIndex={0}
                aria-label={`spot ${index + 1}${spot.label ? `, ${spot.label}` : ""}; arrow keys to move, delete to remove`}
                aria-pressed={active}
                onPointerDown={(event) => begin(event, spot, "move")}
                onFocus={() => setSelectedKey(spot.key)}
                onKeyDown={(event) => nudge(event, spot)}
                style={{ left: `${spot.layout.x}%`, top: `${spot.layout.y}%`, width: `${spot.layout.w}%`, aspectRatio: "1 / 1" }}
                className={cx(
                  "absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-control border-2 font-mono text-small font-semibold active:cursor-grabbing",
                  active ? "z-10 border-accent bg-accent/85 text-white shadow-pop" : "border-white bg-white/80 text-ink backdrop-blur-sm",
                  errors[`spot-${index}`] && !active && "border-danger",
                )}
              >
                {index + 1}
                {active && (
                  <span
                    aria-hidden
                    onPointerDown={(event) => begin(event, spot, "resize")}
                    className="absolute -bottom-1.5 -right-1.5 size-4 cursor-nwse-resize rounded-full border-2 border-white bg-accent"
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="text-small text-muted">drag spots to place them, pull the corner to resize. select one and use arrow keys to nudge.</p>
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <p className="text-body font-semibold">
            {spots.length} spot{spots.length === 1 ? "" : "s"}
          </p>
          <Button size="sm" variant="secondary" onClick={() => add()} disabled={spots.length >= MAX_SPOTS}>
            <Plus className="size-4" aria-hidden /> add spot
          </Button>
        </div>
        {errors.spots && <p className="text-small text-danger">{errors.spots}</p>}

        {selected ? (
          <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <p className="text-body font-medium">spot {selectedIndex + 1}</p>
              <div className="flex gap-1">
                <button type="button" aria-label="duplicate spot" onClick={() => add(selected)} className="cursor-pointer rounded-control p-1.5 text-muted hover:bg-ink/5 hover:text-ink">
                  <Copy className="size-4" />
                </button>
                <button type="button" aria-label="delete spot" onClick={() => remove(selected.key)} className="cursor-pointer rounded-control p-1.5 text-muted hover:bg-danger-soft hover:text-danger">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            <Input label="label (optional)" placeholder="e.g. top left" value={selected.label} maxLength={40} onChange={(event) => patch(selected.key, { label: event.target.value })} />
            <Input
              label="price (USDC)"
              inputMode="decimal"
              value={selected.price}
              onChange={(event) => patch(selected.key, { price: event.target.value })}
              error={errors[`spot-${selectedIndex}`]}
            />
          </div>
        ) : (
          <p className="rounded-card border border-dashed border-line-strong p-4 text-small text-muted">select a spot to edit it.</p>
        )}

        <div className="flex items-end gap-2">
          <Input label="set every price" inputMode="decimal" placeholder="25" value={bulkPrice} onChange={(event) => setBulkPrice(event.target.value)} />
          <Button
            variant="secondary"
            disabled={!bulkPrice.trim()}
            onClick={() => {
              onChange((current) => current.map((spot) => ({ ...spot, price: bulkPrice.trim() })));
              setBulkPrice("");
            }}
          >
            apply
          </Button>
        </div>
      </div>
    </div>
  );
}
