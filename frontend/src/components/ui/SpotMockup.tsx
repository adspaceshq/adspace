"use client";

import Image from "next/image";
import type { SpotLayout, SpotState } from "@/lib/api/types";
import { formatUsd } from "@/lib/money";
import { cx } from "@/lib/cx";

export interface MockupSpot {
  id: string;
  index: number;
  layout: SpotLayout;
  state: SpotState;
  price?: string;
  label?: string;
  // When set (e.g. a sponsor viewing their spot), the brand logo is drawn on the sticker.
  logoUrl?: string;
}

const isTaken = (state: SpotState) => state !== "open" && state !== "refunded";

// Layout coordinates are percentages of the photo: x/y are the sticker centre, w its width.
// Stickers are square unless `h` is given.
export function SpotMockup({
  photoUrl,
  alt,
  spots,
  selectedId,
  onSelect,
  size = "full",
  aspect = "4 / 3",
  className,
}: {
  photoUrl: string;
  alt: string;
  spots: MockupSpot[];
  selectedId?: string;
  onSelect?: (spotId: string) => void;
  size?: "thumb" | "full";
  aspect?: string;
  className?: string;
}) {
  const interactive = Boolean(onSelect) && size === "full";
  return (
    <div
      className={cx("relative w-full overflow-hidden bg-ink/5", size === "full" ? "rounded-panel" : "rounded-card", className)}
      style={{ aspectRatio: aspect }}
    >
      <Image
        src={photoUrl}
        alt={alt}
        fill
        sizes={size === "thumb" ? "(max-width: 768px) 100vw, 25vw" : "(max-width: 1024px) 100vw, 60vw"}
        className="object-cover"
        priority={size === "full"}
      />
      {spots.map((spot) => {
        const taken = isTaken(spot.state);
        const selected = spot.id === selectedId;
        const style = {
          left: `${spot.layout.x}%`,
          top: `${spot.layout.y}%`,
          width: `${spot.layout.w}%`,
          ...(spot.layout.h ? { height: `${spot.layout.h}%` } : { aspectRatio: "1 / 1" }),
        };
        const content =
          spot.logoUrl ? (
            <Image src={spot.logoUrl} alt="" fill sizes="10vw" className="object-contain" />
          ) : size === "full" ? (
            <span className="flex flex-col items-center leading-tight">
              <span className="text-caption font-semibold">{spot.index + 1}</span>
              {!taken && spot.price && <span className="hidden text-caption sm:block">{formatUsd(spot.price)}</span>}
            </span>
          ) : null;
        // Logos are the sticker itself: no backing or border, just rounded corners; selection is a thin outline outside it.
        const tone = spot.logoUrl
          ? cx("border-0 bg-transparent text-ink", selected && "outline-2 outline-offset-2 outline-accent")
          : taken
          ? "border-ink/20 bg-ink/45 text-white"
          : selected
            ? "border-accent bg-accent text-white shadow-pop"
            : "border-white bg-white/85 text-ink backdrop-blur-sm";
        const shared = cx(
          "absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden border-2 font-mono transition",
          size === "full" ? "rounded-control" : "rounded-md",
          tone,
        );
        const label = `spot ${spot.index + 1}${spot.label ? `, ${spot.label}` : ""}${taken ? ", taken" : spot.price ? `, ${formatUsd(spot.price)}` : ""}`;
        return interactive ? (
          <button
            key={spot.id}
            type="button"
            style={style}
            onClick={() => onSelect!(spot.id)}
            aria-label={label}
            aria-pressed={selected}
            className={cx(shared, "cursor-pointer hover:scale-105 focus-visible:scale-105")}
          >
            {content}
          </button>
        ) : (
          <span key={spot.id} style={style} className={shared} aria-hidden={size === "thumb"} title={label}>
            {content}
          </span>
        );
      })}
    </div>
  );
}
