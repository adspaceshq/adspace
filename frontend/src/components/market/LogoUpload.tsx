"use client";

import { ImagePlus, Loader2, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, uploadImage } from "@/lib/upload";

// The sponsor's artwork: exactly what the creator puts on the spot, and what the public listing shows once sold.
export function LogoUpload({
  value,
  onChange,
  creatorHandle,
  error,
  disabled,
}: {
  value?: string;
  onChange: (url: string | undefined) => void;
  creatorHandle: string;
  error?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string>();

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setUploadError(undefined);
    setProgress(0);
    try {
      const asset = await uploadImage("brand_logo", file, { onProgress: setProgress });
      onChange(asset.url);
    } catch (cause) {
      setUploadError((cause as Error).message);
    } finally {
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  const message = uploadError ?? error;
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-small font-medium">your logo</span>
      <input ref={input} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(event) => void pick(event.target.files?.[0])} disabled={disabled} />
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={disabled || progress !== null}
        aria-describedby="logo-hint"
        className={`flex cursor-pointer items-center gap-4 rounded-card border border-dashed p-3 text-left transition-colors hover:border-line-strong disabled:cursor-not-allowed ${message ? "border-danger" : "border-line"}`}
      >
        <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-control border border-line bg-[repeating-conic-gradient(var(--color-canvas)_0_25%,var(--color-surface)_0_50%)] bg-[length:12px_12px]">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element -- local preview of the uploaded logo
            <img src={value} alt="your logo" className="size-full object-contain p-1" />
          ) : progress !== null ? (
            <Loader2 className="size-5 animate-spin text-muted" aria-hidden />
          ) : (
            <ImagePlus className="size-5 text-muted" aria-hidden />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-1.5 text-small font-medium">
            {progress !== null ? `uploading ${Math.round(progress * 100)}%` : value ? (
              <>
                <RefreshCw className="size-3.5" aria-hidden /> replace logo
              </>
            ) : (
              "upload your logo"
            )}
          </span>
          <span id="logo-hint" className="text-small text-muted">
            @{creatorHandle} puts exactly this on the spot. PNG with a transparent background works best.
          </span>
        </span>
      </button>
      {message && (
        <p role="alert" className="text-small text-danger">
          {message}
        </p>
      )}
    </div>
  );
}
