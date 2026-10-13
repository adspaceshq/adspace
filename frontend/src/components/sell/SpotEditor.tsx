"use client";

import { useRef, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import type { WizardSpot } from "@/lib/sell-draft";
import { spotView, withView } from "@/lib/spot-views";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

const MAX_SPOTS = 60;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type Drag = { key: string; mode: "move" | "resize"; startX: number; startY: number; origin: WizardSpot["layout"] };

export interface EditorPhoto {
  url: string;
  label: string;
}

// Spots can sit on any of the listing photos; the canvas shows one photo and the spots placed on it.
// Spot numbers stay global across photos.
export function SpotEditor({
  photos,
  spots,
  onChange,
  errors,
}: {
  photos: EditorPhoto[];
  spots: WizardSpot[];
  onChange: (update: (current: WizardSpot[]) => WizardSpot[]) => void;
  errors: Partial<Record<string, string>>;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | undefined>(spots[0]?.key);
  const [bulkPrice, setBulkPrice] = useState("");
  const [view, setView] = useState(() => (spots[0] ? spotView(spots[0].layout, photos.length) : 0));
  const selectedIndex = spots.findIndex((spot) => spot.key === selectedKey);
  const selected = spots[selectedIndex];
  const multi = photos.length > 1;
  const current = Math.min(view, photos.length - 1);
  const viewOf = (spot: WizardSpot) => spotView(spot.layout, photos.length);

  // Selecting a spot shows the photo it sits on.
  const select = (spot: WizardSpot) => {
    setSelectedKey(spot.key);
    setView(viewOf(spot));
  };

  // Switching photos keeps the selection only when it is on that photo.
  const showView = (index: number) => {
    setView(index);
    if (!selected || viewOf(selected) !== index) setSelectedKey(spots.find((spot) => viewOf(spot) === index)?.key);
  };

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
      : { key: crypto.randomUUID(), label: "", price: spots[0]?.price ?? "10", layout: withView({ x: 50, y: 50, w: 15 }, current) };
    onChange((current) => [...current, spot]);
    setSelectedKey(spot.key);
  };

  // After a delete, select the next spot on the same photo.
  const remove = (key: string) => {
    const onPhoto = spots.filter((spot) => viewOf(spot) === current);
    const index = onPhoto.findIndex((spot) => spot.key === key);
    onChange((list) => list.filter((spot) => spot.key !== key));
    setSelectedKey(onPhoto[index + 1]?.key ?? onPhoto[index - 1]?.key);
  };

  const moveToView = (spot: WizardSpot, index: number) => {
    patch(spot.key, { layout: withView(spot.layout, index) });
    setView(index);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-3">
        {multi && (
          <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist" aria-label="photo to place spots on">
            {photos.map((photo, index) => {
              const count = spots.filter((spot) => viewOf(spot) === index).length;
              const active = index === current;
              return (
                <button
                  key={`${index}-${photo.url}`}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => showView(index)}
                  className={cx(
                    "flex shrink-0 cursor-pointer items-center gap-2 rounded-card border p-1.5 pr-3 text-left transition-colors",
                    active ? "border-ink bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- small editor thumbnail of the seller upload */}
                  <img src={photo.url} alt="" className="aspect-[4/3] w-14 rounded-md bg-ink/5 object-cover" />
                  <span className="flex flex-col leading-tight">
                    <span className={cx("text-small", active ? "font-semibold text-ink" : "text-muted")}>{photo.label}</span>
                    <span className="text-caption text-subtle">
                      {count} spot{count === 1 ? "" : "s"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <div
          ref={frame}
          onPointerMove={moveTo}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
          className="relative aspect-[4/3] touch-none select-none overflow-hidden rounded-panel bg-ink/5"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- editor canvas needs the raw image size-independent */}
          <img src={photos[current].url} alt={multi ? photos[current].label : ""} draggable={false} className="pointer-events-none size-full object-cover" />
          {spots.map((spot, index) => {
            if (viewOf(spot) !== current) return null;
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
        <p className="text-small text-muted">
          drag spots to place them, pull the corner to resize. select one and use arrow keys to nudge.
          {multi && " new spots go on the photo you're looking at."}
        </p>
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

        {multi && (
          <div className="flex flex-col gap-3">
            {photos.map((photo, photoIndex) => {
              const onPhoto = spots.map((spot, index) => ({ spot, index })).filter(({ spot }) => viewOf(spot) === photoIndex);
              return (
                <div key={`${photoIndex}-${photo.url}`} className="flex flex-col gap-1.5">
                  <p className="text-small text-muted">
                    {photo.label} · {onPhoto.length} spot{onPhoto.length === 1 ? "" : "s"}
                  </p>
                  {onPhoto.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {onPhoto.map(({ spot, index }) => (
                        <button
                          key={spot.key}
                          type="button"
                          onClick={() => select(spot)}
                          aria-pressed={spot.key === selectedKey}
                          aria-label={`spot ${index + 1}${spot.label ? `, ${spot.label}` : ""}, on the ${photo.label}`}
                          className={cx(
                            "flex size-8 cursor-pointer items-center justify-center rounded-control border font-mono text-small font-semibold transition-colors",
                            spot.key === selectedKey ? "border-accent bg-accent text-white" : "border-line bg-surface hover:border-line-strong",
                            errors[`spot-${index}`] && spot.key !== selectedKey && "border-danger text-danger",
                          )}
                        >
                          {index + 1}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-caption text-subtle">no spots yet. open this photo and add one.</p>
                  )}
                </div>
              );
            })}
          </div>
        )}

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
            {multi && (
              <div className="flex flex-col gap-1.5">
                <p className="text-small font-medium">on surface</p>
                <div className="flex flex-wrap gap-1 rounded-control bg-ink/5 p-1" role="radiogroup" aria-label={`photo for spot ${selectedIndex + 1}`}>
                  {photos.map((photo, index) => (
                    <button
                      key={`${index}-${photo.url}`}
                      type="button"
                      role="radio"
                      aria-checked={viewOf(selected) === index}
                      onClick={() => moveToView(selected, index)}
                      className={cx(
                        "flex-1 cursor-pointer whitespace-nowrap rounded-[calc(var(--radius-control)-2px)] px-2 py-1 text-small font-medium transition-colors",
                        viewOf(selected) === index ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
                      )}
                    >
                      {photo.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
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
