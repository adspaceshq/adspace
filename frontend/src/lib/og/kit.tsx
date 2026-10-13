// Shared toolkit for Open Graph cards (1200x630). Rendered by next/og (Satori):
// only flexbox layout, inline styles, and TTF/OTF fonts are supported.
import type React from "react";

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const og = {
  ink: "#020817",
  inkSoft: "#0a1730",
  muted: "#64748b",
  subtle: "#94a3b8",
  canvas: "#f4f4f4",
  surface: "#ffffff",
  line: "#e7e5e0",
  accent: "#4166fb",
  accentSoft: "#e9edfe",
  success: "#15803d",
  successSoft: "#e7f6ec",
  warning: "#b45309",
  warningSoft: "#fdf3e2",
} as const;

// Static Inter cuts (Satori can't use variable fonts or woff2).
const FONT_URLS = {
  400: "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZg.ttf",
  600: "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuGKYMZg.ttf",
  700: "https://fonts.gstatic.com/s/inter/v20/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuFuYMZg.ttf",
} as const;

let fontsPromise: Promise<Array<{ name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: "normal" }>> | undefined;

export function loadFonts() {
  fontsPromise ??= Promise.all(
    (Object.entries(FONT_URLS) as Array<[string, string]>).map(async ([weight, url]) => {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) throw new Error(`font ${weight} failed: ${response.status}`);
      return { name: "Inter", data: await response.arrayBuffer(), weight: Number(weight) as 400 | 600 | 700, style: "normal" as const };
    }),
  ).catch((error) => {
    fontsPromise = undefined;
    throw error;
  });
  return fontsPromise;
}

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim();

// Card photos are requested at 2x their tile size through Cloudinary so a multi-megabyte
// original becomes a sharp ~60KB JPEG; Cloudinary caches the result after the first fetch.
// Photos with spots drawn on them use a centre crop, matching the app's object-cover, so the
// spots land where they do in the app; plain photos let Cloudinary pick the subject.
export function cardPhoto(url: string | null | undefined, width: number, height: number, gravity: "auto" | "center" = "auto"): string | null {
  if (!url) return null;
  if (!CLOUD_NAME) return url;
  const transform = `f_jpg,q_85,c_fill,g_${gravity},w_${width * 2},h_${height * 2}`;
  const upload = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.*)$/.exec(url);
  if (upload) return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${upload[1]}`;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/fetch/${transform}/${url}`;
}

// Logos are fitted, not cropped, and kept as PNG so transparent backgrounds survive.
export function cardLogo(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const upload = CLOUD_NAME ? /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.*)$/.exec(url) : null;
  return upload ? `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/f_png,c_fit,w_${size * 2},h_${size * 2}/${upload[1]}` : url;
}

// Only fetch images from where ours live, so a user-set URL can't turn the card renderer into a proxy.
const IMAGE_HOSTS = new Set(
  ["res.cloudinary.com", "pbs.twimg.com", "abs.twimg.com", process.env.NEXT_PUBLIC_SITE_URL, process.env.NEXT_PUBLIC_STATIC_ASSET_BASE]
    .map((entry) => {
      try {
        return entry ? new URL(entry.includes("://") ? entry : `https://${entry}`).host : "";
      } catch {
        return "";
      }
    })
    .filter(Boolean),
);

async function fetchImage(url: string | undefined | null, timeoutMs: number): Promise<{ bytes: Buffer; type: string } | null> {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !IMAGE_HOSTS.has(parsed.host)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "force-cache" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/png";
    if (!/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    return { bytes: Buffer.from(await response.arrayBuffer()), type };
  } catch {
    return null;
  }
}

const dataUrl = ({ bytes, type }: { bytes: Buffer; type: string }) => `data:${type};base64,${bytes.toString("base64")}`;

// Inlines a remote image so one slow or missing photo degrades to a placeholder instead of failing the card.
export async function loadImage(url: string | undefined | null, timeoutMs = 8000): Promise<string | null> {
  const image = await fetchImage(url, timeoutMs);
  return image ? dataUrl(image) : null;
}

// Pixel size from a PNG, GIF or JPEG header; null when unreadable.
function imageSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length >= 24 && bytes.readUInt32BE(0) === 0x89504e47) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (bytes.length >= 10 && bytes.toString("ascii", 0, 3) === "GIF") return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      // SOF0..SOF15, except DHT (c4), JPG (c8) and DAC (cc), carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

export interface CardImage {
  src: string;
  // Natural aspect ratio (width / height); 1 when the header can't be read.
  aspect: number;
}

// A logo plus its aspect ratio, so it can be drawn as a sticker with rounded corners on the logo itself.
export async function loadLogo(url: string | undefined | null, timeoutMs = 8000): Promise<CardImage | null> {
  const image = await fetchImage(url, timeoutMs);
  if (!image) return null;
  const size = imageSize(image.bytes);
  return { src: dataUrl(image), aspect: size && size.width > 0 && size.height > 0 ? size.width / size.height : 1 };
}

// The largest box with the logo's aspect that fits in width x height.
export function fitLogo(aspect: number, width: number, height: number): { width: number; height: number } {
  return aspect >= width / height ? { width, height: width / aspect } : { width: height * aspect, height };
}

export function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

// Mirrors components/Logo.tsx: a white extra-bold "a" bleeding off the right and bottom
// edges of a pure black square (the brand mark, deliberately not the ink token).
export function LogoMark({ size = 56 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, background: "#000", position: "relative", overflow: "hidden", display: "flex" }}>
      <div
        style={{
          position: "absolute",
          left: size * 0.5,
          top: size * 0.16,
          fontSize: size * 1.03,
          fontWeight: 700,
          lineHeight: 1,
          color: "#fff",
          display: "flex",
        }}
      >
        a
      </div>
    </div>
  );
}

export function Brand({ size = 56 }: { size?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: size * 0.3 }}>
      <LogoMark size={size} />
      <div style={{ fontSize: size * 0.62, fontWeight: 700, color: og.ink, letterSpacing: "-0.03em" }}>adspaces</div>
    </div>
  );
}

// The shared backdrop: canvas colour with one soft accent blob bleeding off an edge.
export function Canvas({ blob, children }: { blob: { size: number } & Partial<Record<"left" | "right" | "top" | "bottom", number>>; children: React.ReactNode }) {
  const { size, ...position } = blob;
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", ...position, width: size, height: size, borderRadius: size, background: og.accentSoft, display: "flex" }} />
      {children}
    </div>
  );
}

// Round avatar with the first letter of the name as a fallback.
export function Avatar({ src, name, size, ring = 0 }: { src: string | null; name: string; size: number; ring?: number }) {
  return (
    <div
      style={{
        display: "flex",
        width: size,
        height: size,
        borderRadius: size,
        overflow: "hidden",
        border: ring ? `${ring}px solid ${og.surface}` : "none",
        background: og.accent,
        alignItems: "center",
        justifyContent: "center",
        color: og.surface,
        fontSize: size * 0.44,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
        <img src={src} width={size} height={size} alt="" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      ) : (
        name.replace(/^@+/, "").slice(0, 1).toUpperCase() || "a"
      )}
    </div>
  );
}

// A white tile with a small label over a bold value.
export function StatTile({ label, value, valueSize = 44, flex, style }: { label: string; value: string; valueSize?: number; flex?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: "18px 24px 20px",
        borderRadius: 24,
        background: og.surface,
        border: `1px solid ${og.line}`,
        ...(flex === undefined ? {} : { flex }),
        ...style,
      }}
    >
      <div style={{ display: "flex", fontSize: 20, fontWeight: 600, color: og.muted, letterSpacing: "0.01em" }}>{label}</div>
      <div style={{ display: "flex", fontSize: valueSize, fontWeight: 700, color: og.ink, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</div>
    </div>
  );
}

const PILL_TONES = {
  success: { background: og.success, color: og.surface },
  accent: { background: og.accent, color: og.surface },
  warning: { background: og.warningSoft, color: og.warning },
  soft: { background: og.surface, color: og.inkSoft },
  ink: { background: og.ink, color: og.surface },
} as const;

export function Pill({ children, tone = "soft", size = 22, style }: { children: React.ReactNode; tone?: keyof typeof PILL_TONES; size?: number; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: size * 0.4,
        padding: `${size * 0.4}px ${size * 0.8}px`,
        borderRadius: 999,
        fontSize: size,
        fontWeight: 700,
        lineHeight: 1,
        ...PILL_TONES[tone],
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// A small filled circle, for status pills.
export function Dot({ color, size = 12 }: { color: string; size?: number }) {
  return <div style={{ display: "flex", width: size, height: size, borderRadius: size, background: color, flexShrink: 0 }} />;
}

const FRAME = 8;
const SHADOW = "0 24px 48px -12px rgba(2, 8, 23, 0.28)";

// A photo tile with a designed placeholder when the image is unavailable.
export function PhotoTile({
  src,
  width,
  height,
  rotate = 0,
  style,
}: {
  src: string | null;
  width: number;
  height: number;
  rotate?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        width,
        height,
        borderRadius: 28,
        overflow: "hidden",
        border: `${FRAME}px solid ${og.surface}`,
        background: og.accentSoft,
        boxShadow: SHADOW,
        transform: `rotate(${rotate}deg)`,
        ...style,
      }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
        <img src={src} width={width} height={height} alt="" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
      ) : (
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center" }}>
          <LogoMark size={Math.min(width, height) * 0.28} />
        </div>
      )}
    </div>
  );
}

// Dims the photo around a rounded box: a frame whose huge border is the shade and whose inner edge is the
// box (Satori ignores box-shadow spreads this large). The tile's overflow clips the rest.
function Spotlight({ left, top, width, height, radius }: { left: number; top: number; width: number; height: number; radius: number }) {
  const band = 720;
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        left: left - band,
        top: top - band,
        width: width + band * 2,
        height: height + band * 2,
        borderRadius: radius + band,
        border: `${band}px solid rgba(2, 8, 23, 0.26)`,
      }}
    />
  );
}

export interface MockupSpot {
  index: number;
  layout: { x: number; y: number; w: number; h?: number };
  taken: boolean;
  // The spot this card is about: ringed in the accent colour, with the rest of the photo dimmed.
  highlight?: boolean;
  // Inlined sponsor logo, drawn as the sticker itself (no backing) with slightly rounded corners.
  logo?: CardImage | null;
}

// A listing photo with its ad spots drawn the same way as the in-app SpotMockup thumbnail
// (x/y are the spot's centre in %, w/h its size in % of the photo width/height; no h = square).
// `children` are laid over the photo (e.g. a status pill) and positioned by the caller.
export function MockupTile({
  src,
  width,
  height,
  spots,
  rotate = 0,
  style,
  children,
}: {
  src: string | null;
  width: number;
  height: number;
  spots: MockupSpot[];
  rotate?: number;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}) {
  const inner = { width: width - FRAME * 2, height: height - FRAME * 2 };
  const radius = 28 - FRAME;
  // Satori clips overflow in unrotated space, so a tile with a dimmed spotlight stays upright.
  const angle = spots.some((spot) => spot.highlight) ? 0 : rotate;
  return (
    <div
      style={{
        display: "flex",
        width,
        height,
        padding: FRAME,
        borderRadius: 28,
        background: og.surface,
        boxShadow: SHADOW,
        transform: `rotate(${angle}deg)`,
        ...style,
      }}
    >
      <div style={{ display: "flex", position: "relative", width: inner.width, height: inner.height, borderRadius: radius, overflow: "hidden", background: og.accentSoft }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
          <img src={src} width={inner.width} height={inner.height} alt="" style={{ position: "absolute", left: 0, top: 0, objectFit: "cover", width: inner.width, height: inner.height }} />
        ) : (
          <div style={{ display: "flex", position: "absolute", left: 0, top: 0, width: inner.width, height: inner.height, alignItems: "center", justifyContent: "center" }}>
            <LogoMark size={Math.min(inner.width, inner.height) * 0.24} />
          </div>
        )}
        {/* Spots need the photo under them; on the placeholder they would float on nothing. The highlighted spot goes last so its dimming sits over every other spot. */}
        {(src ? [...spots] : []).sort((a, b) => Number(Boolean(a.highlight)) - Number(Boolean(b.highlight))).map((spot) => {
          const boxW = (spot.layout.w / 100) * inner.width;
          const boxH = spot.layout.h ? (spot.layout.h / 100) * inner.height : boxW;
          const size = spot.logo ? fitLogo(spot.logo.aspect, boxW, boxH) : { width: boxW, height: boxH };
          const left = (spot.layout.x / 100) * inner.width - size.width / 2;
          const top = (spot.layout.y / 100) * inner.height - size.height / 2;
          const corner = Math.max(4, Math.min(12, Math.min(size.width, size.height) / 6));
          const ring = 5;
          const gap = 5;
          return (
            <div key={spot.index} style={{ display: "flex", position: "absolute", left: 0, top: 0, width: inner.width, height: inner.height, overflow: "hidden" }}>
              {spot.highlight && <Spotlight left={left - gap - ring} top={top - gap - ring} width={size.width + (gap + ring) * 2} height={size.height + (gap + ring) * 2} radius={corner + gap + ring} />}
              {spot.highlight && (
                <div
                  style={{
                    display: "flex",
                    position: "absolute",
                    left: left - gap - ring,
                    top: top - gap - ring,
                    width: size.width + (gap + ring) * 2,
                    height: size.height + (gap + ring) * 2,
                    borderRadius: corner + gap + ring,
                    border: `${ring}px solid ${og.accent}`,
                  }}
                />
              )}
              <div
                style={{
                  display: "flex",
                  position: "absolute",
                  left,
                  top,
                  width: size.width,
                  height: size.height,
                  borderRadius: corner,
                  overflow: "hidden",
                  border: spot.logo ? "none" : `3px solid ${spot.highlight ? og.surface : spot.taken ? "rgba(2, 8, 23, 0.2)" : og.surface}`,
                  background: spot.logo ? "transparent" : spot.highlight ? og.accent : spot.taken ? "rgba(2, 8, 23, 0.45)" : "rgba(255, 255, 255, 0.85)",
                  ...(spot.logo ? { boxShadow: "0 6px 16px rgba(2, 8, 23, 0.28)" } : {}),
                }}
              >
                {spot.logo && (
                  // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
                  <img src={spot.logo.src} width={size.width} height={size.height} alt="" style={{ width: size.width, height: size.height, objectFit: "cover" }} />
                )}
              </div>
            </div>
          );
        })}
        {children}
      </div>
    </div>
  );
}

// Dynamic cards take ~2s to draw; crawlers (X, LinkedIn) give up quickly. Let the CDN cache them
// for an hour and serve stale while it redraws, so a preview is always instant.
export const OG_CACHE_HEADERS = { "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400" };

// X serves 48px "_normal" avatars by default; the 400px cut of the same image stays sharp on a card.
export function cardAvatar(url: string | null | undefined, size: number): string | null {
  const sharp = url?.replace(/^(https:\/\/pbs\.twimg\.com\/.+|https:\/\/abs\.twimg\.com\/.+)_normal(\.\w+)$/, "$1_400x400$2");
  return cardPhoto(sharp, size, size);
}
