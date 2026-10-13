import { ImageResponse } from "next/og";
import { HERO_IMAGE_1, HERO_IMAGE_2, MAC_LID_PHOTO } from "@/lib/assets";
import { Brand, Canvas, cardPhoto, Dot, loadFonts, loadImage, MockupTile, og, OG_SIZE, PhotoTile, Pill } from "@/lib/og/kit";

export const alt = "adspaces — sell ad space on anything people see";
export const size = OG_SIZE;
export const contentType = "image/png";
// Regenerate at most hourly; the product card rarely changes.
export const revalidate = 3600;

const LID = { width: 340, height: 255 };
// Two open spots on the lid, as a seller would place them (centre x/y and width in %).
const LID_SPOTS = [
  { index: 0, layout: { x: 30, y: 34, w: 16 }, taken: false },
  { index: 1, layout: { x: 70, y: 64, w: 20, h: 18 }, taken: false },
];

export default async function Image() {
  const [fonts, laptop, heroOne, heroTwo] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(MAC_LID_PHOTO, LID.width, LID.height, "center")),
    loadImage(cardPhoto(HERO_IMAGE_1, 280, 340)),
    loadImage(cardPhoto(HERO_IMAGE_2, 250, 300)),
  ]);

  return new ImageResponse(
    (
      <Canvas blob={{ size: 640, right: -180, top: -200 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: 620 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", fontSize: 66, fontWeight: 700, color: og.ink, lineHeight: 1.02, letterSpacing: "-0.045em" }}>sell ad space on anything people see.</div>
            <div style={{ display: "flex", fontSize: 28, color: og.muted, lineHeight: 1.35, maxWidth: 520 }}>laptops, cars, suitcases. sponsors pay in USDC, held in escrow until delivery.</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Pill tone="ink" size={24}>
              list your first spot
            </Pill>
            <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: og.accent }}>adspaces.fun</div>
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", flex: 1 }}>
          <PhotoTile src={heroOne} width={280} height={340} rotate={-6} style={{ position: "absolute", left: 40, top: 40 }} />
          <PhotoTile src={heroTwo} width={250} height={300} rotate={5} style={{ position: "absolute", left: 290, top: 270 }} />
          <MockupTile src={laptop} width={LID.width} height={LID.height} rotate={-2} spots={LID_SPOTS} style={{ position: "absolute", left: 170, top: 150 }}>
            <Pill tone="soft" size={18} style={{ position: "absolute", left: 12, bottom: 12, boxShadow: "0 8px 20px rgba(2, 8, 23, 0.25)" }}>
              <Dot color={og.success} size={9} />2 spots open
            </Pill>
          </MockupTile>
        </div>
      </Canvas>
    ),
    { ...size, fonts },
  );
}
