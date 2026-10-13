import type { Db } from "../db/client.js";
import { mediaAssets } from "../db/schema.js";
import { isOwnUpload, signedUploadPayload, type CloudinaryUploadKind } from "../cloudinary.js";

export class MediaError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type AssetKind = (typeof mediaAssets.$inferInsert)["kind"];

// Each asset kind uploads into its own Cloudinary folder, images only.
const FOLDERS: Record<AssetKind, CloudinaryUploadKind> = {
  listing_photo: "listings",
  post_media: "posts",
  brand_logo: "logos",
  evidence: "evidence",
  avatar: "avatars",
};
const IMAGE_FORMATS = ["jpg", "jpeg", "png", "webp", "heic", "avif"];
const MAX_BYTES = 15 * 1024 * 1024;

export function parseAssetKind(value: unknown): AssetKind {
  if (typeof value === "string" && value in FOLDERS) return value as AssetKind;
  throw new MediaError("kind must be listing_photo, post_media, brand_logo, evidence or avatar");
}

export function signUpload(kind: AssetKind) {
  return { kind, ...signedUploadPayload(FOLDERS[kind], { allowedFormats: IMAGE_FORMATS }) };
}

// Registers a finished upload so it can be attached to listings, posts, disputes or a brand.
export async function registerMedia(
  db: Db,
  ownerId: string,
  kind: AssetKind,
  input: { url: unknown; bytes: unknown; width?: unknown; height?: unknown },
) {
  const url = typeof input.url === "string" ? input.url.trim() : "";
  if (!isOwnUpload(url, FOLDERS[kind])) throw new MediaError("upload the file through adspaces first");
  const bytes = Number(input.bytes);
  if (!Number.isInteger(bytes) || bytes <= 0) throw new MediaError("bytes must be a positive whole number");
  if (bytes > MAX_BYTES) throw new MediaError("images must be 15MB or smaller");
  const dimension = (value: unknown) => {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 && number <= 20_000 ? number : null;
  };
  const [asset] = await db
    .insert(mediaAssets)
    .values({ ownerId, kind, url, bytes, width: dimension(input.width), height: dimension(input.height) })
    .returning();
  return asset;
}
