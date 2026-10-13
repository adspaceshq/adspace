import { ImageResponse } from "next/og";
import { fetchBrowsePreview } from "@/lib/api/server";
import { HERO_IMAGE_1, HERO_IMAGE_2, HERO_IMAGE_3 } from "@/lib/assets";
import { priceSummary } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";
import { Brand, Canvas, cardLogo, cardPhoto, Dot, loadFonts, loadImage, loadLogo, MockupTile, og, OG_SIZE, Pill } from "@/lib/og/kit";
import { spotsOnView } from "@/lib/spot-views";

export const alt = "browse ad space on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 600;

const TILES = [
  { width: 330, height: 248, left: 30, top: 60, rotate: -5 },
  { width: 280, height: 210, left: 250, top: 200, rotate: 4 },
  { width: 260, height: 195, left: 20, top: 380, rotate: 2 },
];
// Landing photos fill the slots when there are fewer live listings than tiles.
const FALLBACK = [HERO_IMAGE_1, HERO_IMAGE_2, HERO_IMAGE_3];

export default async function Image() {
  const listings = (await fetchBrowsePreview().catch(() => [])).filter((listing) => listing.photos[0]).slice(0, TILES.length);
  const coverSpots = listings.map((listing) => spotsOnView(listing.spots, 0, listing.photos.length));
  const fallbacks = FALLBACK.slice(0, TILES.length - listings.length);
  const [fonts, photos, logos] = await Promise.all([
    loadFonts(),
    Promise.all(TILES.map((tile, index) => loadImage(cardPhoto(listings[index]?.photos[0]?.url ?? fallbacks[index - listings.length], tile.width, tile.height, listings[index] ? "center" : "auto")))),
    Promise.all(coverSpots.map((spots, index) => Promise.all(spots.map((spot) => loadLogo(cardLogo(spot.brand?.logoUrl, Math.round((spot.layout.w / 100) * TILES[index].width))))))),
  ]);
  // Draw back to front so the first (newest) listing sits on top.
  const tiles = TILES.map((tile, index) => ({ tile, index, listing: listings[index] })).reverse();

  return new ImageResponse(
    (
      <Canvas blob={{ size: 700, right: -180, bottom: -300 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: 620 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", fontSize: 68, fontWeight: 700, color: og.ink, lineHeight: 1.03, letterSpacing: "-0.045em" }}>ad space on things people actually see.</div>
            <div style={{ display: "flex", fontSize: 26, color: og.muted, lineHeight: 1.35 }}>laptops, cars, suitcases and more. pay in USDC, released only on delivery.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Pill tone="ink" size={24}>
              browse live listings
            </Pill>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: og.accent }}>adspaces.fun</div>
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", flex: 1 }}>
          {tiles.map(({ tile, index, listing }) => {
            const price = listing ? priceSummary(listing) : null;
            return (
              <MockupTile
                key={index}
                src={photos[index]}
                width={tile.width}
                height={tile.height}
                rotate={tile.rotate}
                spots={(coverSpots[index] ?? []).map((spot, spotIndex) => ({ index: spot.index, layout: spot.layout, taken: spot.taken, logo: logos[index]?.[spotIndex] }))}
                style={{ position: "absolute", left: tile.left, top: tile.top }}
              >
                {listing && (
                  <Pill tone="soft" size={18} style={{ position: "absolute", left: 12, bottom: 12, boxShadow: "0 8px 20px rgba(2, 8, 23, 0.25)" }}>
                    <Dot color={og.success} size={9} />
                    {price ? `${price.label} ${formatUsd(price.amount)}` : "all spots taken"}
                  </Pill>
                )}
              </MockupTile>
            );
          })}
        </div>
      </Canvas>
    ),
    { ...size, fonts },
  );
}
