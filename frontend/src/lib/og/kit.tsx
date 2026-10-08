// Shared toolkit for Open Graph cards (1200x630). Rendered by next/og (Satori):
// only flexbox layout, inline styles, and TTF/OTF fonts are supported.

export const OG_SIZE = { width: 1200, height: 630 } as const;

export const og = {
  ink: "#020817",
  inkSoft: "#0a1730",
  muted: "#64748b",
  canvas: "#f4f4f4",
  surface: "#ffffff",
  line: "#e7e5e0",
  accent: "#4166fb",
  accentSoft: "#e9edfe",
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
export function cardPhoto(url: string | null | undefined, width: number, height: number): string | null {
  if (!url) return null;
  if (!CLOUD_NAME) return url;
  const transform = `f_jpg,q_85,c_fill,g_auto,w_${width * 2},h_${height * 2}`;
  const upload = /^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/(.*)$/.exec(url);
  if (upload) return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/${upload[1]}`;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/fetch/${transform}/${url}`;
}

// Inlines a remote image so one slow or missing photo degrades to a placeholder instead of failing the card.
export async function loadImage(url: string | undefined | null, timeoutMs = 8000): Promise<string | null> {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), cache: "force-cache" });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "image/png";
    if (!/^image\/(png|jpe?g|webp|gif)/.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
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
          top: size * 0.3,
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
        border: `8px solid ${og.surface}`,
        background: og.accentSoft,
        boxShadow: "0 24px 48px -12px rgba(2, 8, 23, 0.28)",
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
