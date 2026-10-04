import { createHash } from "node:crypto";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim() ?? "";
const apiKey = process.env.CLOUDINARY_API_KEY?.trim() ?? "";
const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim() ?? "";
const rootFolder = (process.env.CLOUDINARY_UPLOAD_FOLDER?.trim() || "adspaces").replace(/^\/+|\/+$/g, "");

export type CloudinaryUploadKind = "listings" | "logos" | "proofs" | "videos" | "static/landing";

export function cloudinaryConfigured(): boolean {
  return Boolean(cloudName && apiKey && apiSecret);
}

function safeKind(value: unknown): CloudinaryUploadKind {
  if (value === "listings" || value === "logos" || value === "proofs" || value === "videos" || value === "static/landing") return value;
  return "listings";
}

function signature(params: Record<string, string | number>): string {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
  return createHash("sha1").update(`${payload}${apiSecret}`).digest("hex");
}

export function signedUploadPayload(kindInput: unknown) {
  if (!cloudinaryConfigured()) throw Object.assign(new Error("Cloudinary is not configured"), { status: 503 });
  const kind = safeKind(kindInput);
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = `${rootFolder}/${kind}`;
  const params = { folder, timestamp };
  return {
    cloudName,
    apiKey,
    folder,
    timestamp,
    signature: signature(params),
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
  };
}

export function isHostedAssetUrl(value: string | undefined): boolean {
  if (!value) return false;
  return /^https:\/\/res\.cloudinary\.com\/[^/\s]+\/(?:image|video|raw)\/upload\//i.test(value);
}
