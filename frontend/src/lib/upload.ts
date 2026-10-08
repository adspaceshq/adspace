import { api } from "@/lib/api/v2";
import type { AssetKind, MediaAsset } from "@/lib/api/types";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const ACCEPTED = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/avif"];
export const ACCEPT_ATTRIBUTE = ACCEPTED.join(",");

// Checked before signing so users get an instant, specific message.
export function validateImageFile(file: Pick<File, "type" | "size">): string | null {
  if (!ACCEPTED.includes(file.type)) return "use a JPG, PNG, WebP, HEIC or AVIF image";
  if (file.size > MAX_UPLOAD_BYTES) return "images must be 15MB or smaller";
  if (file.size === 0) return "that file is empty";
  return null;
}

interface CloudinaryResponse {
  secure_url: string;
  bytes: number;
  width?: number;
  height?: number;
  error?: { message: string };
}

// Uploads straight to Cloudinary with a server-issued signature, then registers the asset with the API.
// XHR rather than fetch because only XHR reports upload progress.
export async function uploadImage(
  kind: AssetKind,
  file: File,
  options: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<MediaAsset> {
  const invalid = validateImageFile(file);
  if (invalid) throw new Error(invalid);
  const signed = await api.media.sign(kind);
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", signed.apiKey);
  form.append("timestamp", String(signed.timestamp));
  form.append("signature", signed.signature);
  form.append("folder", signed.folder);
  if (signed.allowedFormats) form.append("allowed_formats", signed.allowedFormats);

  const uploaded = await new Promise<CloudinaryResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", signed.uploadUrl);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let body: CloudinaryResponse;
      try {
        body = JSON.parse(xhr.responseText) as CloudinaryResponse;
      } catch {
        return reject(new Error("upload failed; try again"));
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.secure_url) resolve(body);
      else reject(new Error(body.error?.message ?? "upload failed; try again"));
    };
    xhr.onerror = () => reject(new Error("network error during upload"));
    xhr.onabort = () => reject(new DOMException("upload cancelled", "AbortError"));
    options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(form);
  });

  options.onProgress?.(1);
  return api.media.register({ kind, url: uploaded.secure_url, bytes: uploaded.bytes, width: uploaded.width, height: uploaded.height });
}
