import { createHash } from "node:crypto";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
const apiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? "";
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? "";
const rootFolder = (process.env.CLOUDINARY_UPLOAD_FOLDER?.trim() || "adspaces").replace(/^\/+|\/+$/g, "");

export type CloudinaryUploadKind = "listings" | "logos" | "proofs" | "videos" | "static/landing" | "posts" | "evidence" | "avatars";

const KINDS: readonly CloudinaryUploadKind[] = ["listings", "logos", "proofs", "videos", "static/landing", "posts", "evidence", "avatars"];

export function cloudinaryConfigured(): boolean {
  return Boolean(cloudName && apiKey && apiSecret);
}

function safeKind(value: unknown): CloudinaryUploadKind {
  return KINDS.includes(value as CloudinaryUploadKind) ? (value as CloudinaryUploadKind) : "listings";
}

function signature(params: Record<string, string | number>): string {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

// `allowedFormats` is part of the signature, so Cloudinary rejects any other file type.
export function signedUploadPayload(kindInput: unknown, options: { allowedFormats?: string[] } = {}) {
  if (!cloudinaryConfigured()) throw Object.assign(new Error("Cloudinary is not configured"), { status: 503 });
  const kind = safeKind(kindInput);
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${rootFolder}/${kind}`;
  const allowedFormats = options.allowedFormats?.join(",") ?? "";
  const params: Record<string, string | number> = { folder, timestamp, ...(allowedFormats ? { allowed_formats: allowedFormats } : {}) };
  return {
    cloudName,
    apiKey,
    folder,
    timestamp,
    ...(allowedFormats ? { allowedFormats } : {}),
    signature: signature(params),
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/${allowedFormats ? "image" : "auto"}/upload`,
  };
}

// Our own uploads only: right cloud account, image delivery, and the expected folder.
export function isOwnUpload(url: string, kind: CloudinaryUploadKind): boolean {
  if (!cloudName) return false;
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!url.startsWith(prefix) || url.length > 500 || /\s/.test(url)) return false;
  // Anchored: an optional version, then exactly our folder, so the folder can't appear later in the path.
  const folder = `${rootFolder}/${kind}/`.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^(?:v\\d+/)?${folder}[^/]+$`).test(url.slice(prefix.length));
}
