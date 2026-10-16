"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImagePlus, RotateCcw, X } from "lucide-react";
import { ACCEPT_ATTRIBUTE, uploadImage, validateImageFile } from "@/lib/upload";
import type { WizardPhoto } from "@/lib/sell-draft";
import { cx } from "@/lib/cx";
import { userErrorMessage } from "@/lib/errors";
import type { AssetKind } from "@/lib/api/types";


interface Pending {
  id: string;
  file: File;
  preview: string;
  progress: number;
  error?: string;
}

// Listing photos by default; also used for dispute evidence (kind "evidence", no cover).
export function PhotoUploader({
  photos,
  onChange,
  error,
  kind = "listing_photo",
  max = 6,
  cover = true,
  addLabel = "add photos",
  disabled = false,
  onUploadingChange,
}: {
  photos: WizardPhoto[];
  // Updater form: concurrent uploads each apply to the newest list, so none overwrites another.
  onChange: (update: (current: WizardPhoto[]) => WizardPhoto[]) => void;
  error?: string;
  kind?: AssetKind;
  max?: number;
  // Labels the first photo as the cover.
  cover?: boolean;
  addLabel?: string;
  disabled?: boolean;
  // True while any upload is still in flight or failed, so a form can wait before submitting.
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<string>();
  const uploading = pending.length > 0;
  useEffect(() => onUploadingChange?.(uploading), [uploading, onUploadingChange]);

  const update = (id: string, patch: Partial<Pending>) =>
    setPending((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const start = async (item: Pending) => {
    update(item.id, { error: undefined, progress: 0 });
    try {
      const asset = await uploadImage(kind, item.file, { onProgress: (progress) => update(item.id, { progress }) });
      onChange((current) => [...current, { assetId: asset.id, url: asset.url }]);
      URL.revokeObjectURL(item.preview);
      setPending((items) => items.filter((entry) => entry.id !== item.id));
    } catch (cause) {
      update(item.id, { error: userErrorMessage(cause, "upload failed") });
    }
  };

  const add = (files: FileList | File[]) => {
    setNotice(undefined);
    const room = max - photos.length - pending.length;
    const list = Array.from(files);
    if (list.length > room) setNotice(`you can add ${Math.max(room, 0)} more photo${room === 1 ? "" : "s"}`);
    for (const file of list.slice(0, Math.max(room, 0))) {
      const invalid = validateImageFile(file);
      if (invalid) {
        setNotice(`${file.name}: ${invalid}`);
        continue;
      }
      const item: Pending = { id: crypto.randomUUID(), file, preview: URL.createObjectURL(file), progress: 0 };
      setPending((items) => [...items, item]);
      void start(item);
    }
  };

  const move = (index: number, delta: number) => {
    onChange((current) => {
      const next = [...current];
      const [photo] = next.splice(index, 1);
      next.splice(index + delta, 0, photo);
      return next;
    });
  };

  const full = photos.length + pending.length >= max;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <figure key={photo.assetId} className="group relative aspect-[4/3] overflow-hidden rounded-card border border-line bg-ink/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- just-uploaded Cloudinary preview */}
            <img src={photo.url} alt={`photo ${index + 1}`} className="size-full object-cover" />
            {cover && index === 0 && (
              <figcaption className="absolute left-2 top-2 rounded-full bg-ink px-2 py-0.5 text-caption font-medium text-white">cover</figcaption>
            )}
            <div className="absolute inset-x-2 bottom-2 flex justify-between opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
              <div className="flex gap-1">
                <button type="button" aria-label="move earlier" disabled={index === 0} onClick={() => move(index, -1)} className="cursor-pointer rounded-full bg-surface/90 p-1.5 shadow-card disabled:opacity-40">
                  <ChevronLeft className="size-4" />
                </button>
                <button type="button" aria-label="move later" disabled={index === photos.length - 1} onClick={() => move(index, 1)} className="cursor-pointer rounded-full bg-surface/90 p-1.5 shadow-card disabled:opacity-40">
                  <ChevronRight className="size-4" />
                </button>
              </div>
              <button type="button" aria-label="remove photo" onClick={() => onChange((current) => current.filter((entry) => entry.assetId !== photo.assetId))} className="cursor-pointer rounded-full bg-surface/90 p-1.5 shadow-card">
                <X className="size-4" />
              </button>
            </div>
          </figure>
        ))}
        {pending.map((item) => (
          <div key={item.id} className="relative aspect-[4/3] overflow-hidden rounded-card border border-line bg-ink/5">
            {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
            <img src={item.preview} alt="" className="size-full object-cover opacity-60" />
            {item.error ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 p-3 text-center">
                <p className="text-small text-danger">{item.error}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void start(item)} className="inline-flex cursor-pointer items-center gap-1 rounded-control bg-ink px-2.5 py-1 text-small text-white">
                    <RotateCcw className="size-3.5" aria-hidden /> retry
                  </button>
                  <button type="button" onClick={() => setPending((items) => items.filter((entry) => entry.id !== item.id))} className="cursor-pointer rounded-control px-2.5 py-1 text-small text-muted hover:text-ink">
                    remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-surface/80" role="progressbar" aria-label="uploading" aria-valuenow={Math.round(item.progress * 100)}>
                <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(item.progress * 100)}%` }} />
              </div>
            )}
          </div>
        ))}
        {!full && !disabled && (
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              add(event.dataTransfer.files);
            }}
            className={cx(
              "flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed text-small transition-colors",
              dragging ? "border-accent bg-accent-soft text-accent" : "border-line-strong text-muted hover:border-ink hover:text-ink",
            )}
          >
            <ImagePlus className="size-6" aria-hidden />
            {photos.length === 0 ? addLabel : "add more"}
            <span className="text-caption text-subtle">up to {max}, 15MB each</span>
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files) add(event.target.files);
          event.target.value = "";
        }}
      />
      {(notice || error) && (
        <p role="alert" className="text-small text-danger">
          {notice ?? error}
        </p>
      )}
    </div>
  );
}
