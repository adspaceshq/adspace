import { ImageResponse } from "next/og";
import { fetchBrowsePreview } from "@/lib/api/server";
import { Brand, cardPhoto, loadFonts, loadImage, og, OG_SIZE, PhotoTile } from "@/lib/og/kit";

export const alt = "browse ad space on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

const TILES = [
  { width: 250, height: 300, left: 40, top: 60, rotate: -5 },
  { width: 250, height: 300, left: 250, top: 170, rotate: 3 },
  { width: 220, height: 260, left: 60, top: 330, rotate: 4 },
];

export default async function Image() {
  const listings = await fetchBrowsePreview().catch(() => []);
  const photos = listings.map((listing) => listing.photos[0]?.url).filter(Boolean).slice(0, TILES.length);
  const [fonts, ...images] = await Promise.all([loadFonts(), ...TILES.map((tile, index) => loadImage(cardPhoto(photos[index], tile.width, tile.height)))]);

  return (
    new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", right: -160, bottom: -260, width: 680, height: 680, borderRadius: 680, background: og.accentSoft, display: "flex" }} />
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 0 64px 80px", width: 640 }}>
            <Brand size={52} />
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: og.ink, lineHeight: 1.04, letterSpacing: "-0.045em" }}>ad space on things people actually see.</div>
              <div style={{ display: "flex", fontSize: 28, color: og.muted, lineHeight: 1.35 }}>laptops, cars, suitcases and more. pay in USDC, only on delivery.</div>
            </div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700, color: og.ink }}>browse live listings at adspaces.fun</div>
          </div>
          <div style={{ display: "flex", position: "relative", flex: 1 }}>
            {TILES.slice(0, Math.max(photos.length, 1)).map((tile, index) => (
              <PhotoTile key={index} src={images[index]} width={tile.width} height={tile.height} rotate={tile.rotate} style={{ position: "absolute", left: tile.left, top: tile.top }} />
            ))}
          </div>
        </div>
      ),
      { ...size, fonts },
    )
  );
}
