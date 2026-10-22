// Cloudinary does resizing and format negotiation itself, so images skip Next's built-in
// optimizer. Other sources are served as-is.
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(.*)$/;

export default function imageLoader({ src, width, quality }: { src: string; width: number; quality?: number }): string {
  const match = CLOUDINARY_UPLOAD.exec(src);
  if (match) return `${match[1]}f_auto,q_${quality ?? "auto"},c_limit,w_${width}/${match[2]}`;
  if (src.startsWith("/")) return `${src}${src.includes("?") ? "&" : "?"}w=${width}`;
  return src;
}
