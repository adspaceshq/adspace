"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ImagePlus, Link2, X } from "lucide-react";
import { api } from "@/lib/api/v2";
import { queryKeys } from "@/lib/query";
import { ACCEPT_ATTRIBUTE, uploadImage } from "@/lib/upload";
import { Button } from "@/components/ui/Button";

const MAX_MEDIA = 4;
const detect = (url: string) => {
  if (/(^|\.)(x|twitter)\.com\//i.test(url)) return "X post";
  if (/instagram\.com\//i.test(url)) return "Instagram post";
  if (/tiktok\.com\//i.test(url)) return "TikTok";
  if (/(youtube\.com|youtu\.be)\//i.test(url)) return "YouTube";
  return url ? "link" : null;
};

export function PostComposer({ listingId }: { listingId: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [body, setBody] = useState("");
  const [media, setMedia] = useState<Array<{ id: string; url: string }>>([]);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string>();

  const post = useMutation({
    mutationFn: () =>
      api.listings.createPost(listingId, {
        url: url.trim() || undefined,
        body: body.trim() || undefined,
        mediaAssetIds: media.map((item) => item.id),
      }),
    onSuccess: () => {
      setUrl("");
      setBody("");
      setMedia([]);
      void queryClient.invalidateQueries({ queryKey: queryKeys.posts(listingId) });
    },
  });

  const addFiles = async (files: FileList) => {
    setUploadError(undefined);
    const list = Array.from(files).slice(0, MAX_MEDIA - media.length);
    setUploading((count) => count + list.length);
    await Promise.all(
      list.map(async (file) => {
        try {
          const asset = await uploadImage("post_media", file);
          setMedia((current) => [...current, { id: asset.id, url: asset.url }]);
        } catch (cause) {
          setUploadError(cause instanceof Error ? cause.message : "upload failed");
        } finally {
          setUploading((count) => count - 1);
        }
      }),
    );
  };

  const kind = detect(url.trim());
  const empty = !url.trim() && !body.trim() && media.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <p className="text-body font-semibold">post an update</p>
      <label className="relative block">
        <span className="sr-only">link</span>
        <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="paste an X, Instagram, TikTok or YouTube link"
          className="h-10 w-full rounded-control border border-line bg-surface pl-9 pr-3 text-body placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </label>
      {kind && <p className="-mt-1 text-small text-muted">detected: {kind}</p>}
      <label>
        <span className="sr-only">text</span>
        <textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          rows={3}
          maxLength={1000}
          placeholder="what's happening with your space? e.g. 'laptop's at booth 4 all day'"
          className="w-full resize-none rounded-control border border-line bg-surface px-3 py-2 text-body placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
      </label>
      {(media.length > 0 || uploading > 0) && (
        <div className="flex flex-wrap gap-2">
          {media.map((item) => (
            <div key={item.id} className="relative size-20 overflow-hidden rounded-control border border-line">
              {/* eslint-disable-next-line @next/next/no-img-element -- just-uploaded preview */}
              <img src={item.url} alt="" className="size-full object-cover" />
              <button
                type="button"
                aria-label="remove photo"
                onClick={() => setMedia((current) => current.filter((entry) => entry.id !== item.id))}
                className="absolute right-1 top-1 cursor-pointer rounded-full bg-surface/90 p-0.5"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          {Array.from({ length: uploading }, (_, index) => (
            <div key={index} className="size-20 animate-pulse rounded-control bg-ink/5" aria-label="uploading" />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={media.length + uploading >= MAX_MEDIA}
          className="inline-flex cursor-pointer items-center gap-1.5 text-small text-muted hover:text-ink disabled:opacity-40"
        >
          <ImagePlus className="size-4" aria-hidden /> photos
        </button>
        <Button size="sm" onClick={() => post.mutate()} loading={post.isPending} disabled={empty || uploading > 0}>
          post
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          if (event.target.files) void addFiles(event.target.files);
          event.target.value = "";
        }}
      />
      {(uploadError || post.isError) && (
        <p role="alert" className="text-small text-danger">
          {uploadError ?? post.error?.message}
        </p>
      )}
    </div>
  );
}
