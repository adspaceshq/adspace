"use client";

import Image from "next/image";
import { useState } from "react";
import { cx } from "@/lib/cx";
import { spotView, viewLabel } from "@/lib/spot-views";
import { SpotMockup, type MockupSpot } from "./SpotMockup";

export interface SpotPhoto {
  url: string;
  label?: string;
}

// A listing's photos with each spot drawn on the photo it sits on. With one photo it is a plain SpotMockup;
// with more, thumbnails underneath switch photos, and selecting a spot brings its photo into view.
export function SpotPhotos({
  photos,
  alt,
  spots,
  selectedId,
  onSelect,
  className,
}: {
  photos: SpotPhoto[];
  alt: string;
  spots: MockupSpot[];
  selectedId?: string;
  onSelect?: (spotId: string) => void;
  className?: string;
}) {
  const count = photos.length;
  const viewOf = (id?: string) => {
    const spot = spots.find((item) => item.id === id);
    return spot ? spotView(spot.layout, count) : 0;
  };
  const [view, setView] = useState(() => viewOf(selectedId));
  // Follow the selection: picking a spot elsewhere (a list, a table) shows the photo it sits on.
  const [followed, setFollowed] = useState(selectedId);
  if (followed !== selectedId) {
    setFollowed(selectedId);
    if (selectedId) setView(viewOf(selectedId));
  }

  if (count === 0) return <div className={cx("aspect-[4/3] rounded-panel bg-ink/5", className)} />;
  const current = Math.min(view, count - 1);
  const onPhoto = spots.filter((spot) => spotView(spot.layout, count) === current);
  const label = (index: number) => photos[index].label ?? viewLabel(index);

  return (
    <div className={cx("flex flex-col gap-3", className)}>
      <SpotMockup photoUrl={photos[current].url} alt={count > 1 ? `${alt}, ${label(current)}` : alt} spots={onPhoto} selectedId={selectedId} onSelect={onSelect} />
      {count > 1 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto" role="group" aria-label="photos">
          {photos.map((photo, index) => {
            const onThis = spots.filter((spot) => spotView(spot.layout, count) === index).length;
            const active = index === current;
            return (
              <button
                key={`${index}-${photo.url}`}
                type="button"
                aria-pressed={active}
                onClick={() => setView(index)}
                className={cx(
                  "flex shrink-0 cursor-pointer items-center gap-2 rounded-card border p-1.5 pr-3 text-left transition-colors",
                  active ? "border-ink bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <span className="relative block aspect-[4/3] w-14 overflow-hidden rounded-md bg-ink/5">
                  <Image src={photo.url} alt="" fill sizes="56px" className="object-cover" />
                </span>
                <span className="flex flex-col leading-tight">
                  <span className={cx("text-small", active ? "font-semibold text-ink" : "text-muted")}>{label(index)}</span>
                  <span className="text-caption text-subtle">
                    {onThis} spot{onThis === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
