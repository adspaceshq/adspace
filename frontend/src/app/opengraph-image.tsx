import { ImageResponse } from "next/og";
import { HERO_IMAGE_1, HERO_IMAGE_2, MAC_LID_PHOTO } from "@/lib/assets";
import { Brand, cardPhoto, loadFonts, loadImage, og, OG_SIZE, PhotoTile } from "@/lib/og/kit";

export const alt = "adspaces — sell ad space on anything people see";
export const size = OG_SIZE;
export const contentType = "image/png";
// Regenerate at most hourly; the product card rarely changes.
export const revalidate = 3600;

export default async function Image() {
  const [fonts, laptop, heroOne, heroTwo] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(MAC_LID_PHOTO, 250, 190)),
    loadImage(cardPhoto(HERO_IMAGE_1, 300, 360)),
    loadImage(cardPhoto(HERO_IMAGE_2, 260, 320)),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: og.canvas,
          fontFamily: "Inter",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            right: -180,
            top: -180,
            width: 620,
            height: 620,
            borderRadius: 620,
            background: og.accentSoft,
            display: "flex",
          }}
        />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 0 64px 80px", width: 640 }}>
          <Brand size={56} />
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ fontSize: 76, fontWeight: 700, color: og.ink, lineHeight: 1.02, letterSpacing: "-0.045em" }}>
              sell ad space on anything people see.
            </div>
            <div style={{ fontSize: 28, fontWeight: 400, color: og.muted, lineHeight: 1.35, maxWidth: 520 }}>
              laptops, cars, suitcases. sponsors pay in USDC, held in escrow until delivery.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 600, color: og.accent }}>
            adspaces.fun
          </div>
        </div>
        <div style={{ display: "flex", position: "relative", flex: 1 }}>
          <PhotoTile src={heroOne} width={300} height={360} rotate={-6} style={{ position: "absolute", left: 30, top: 70 }} />
          <PhotoTile src={heroTwo} width={260} height={320} rotate={5} style={{ position: "absolute", left: 270, top: 210 }} />
          <PhotoTile src={laptop} width={250} height={190} rotate={-3} style={{ position: "absolute", left: 230, top: 40 }} />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
