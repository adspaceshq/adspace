import { ImageResponse } from "next/og";
import { fetchSponsoredSpot } from "@/lib/api/server";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { Brand, cardPhoto, loadFonts, loadImage, MockupTile, og, OG_SIZE, truncate } from "@/lib/og/kit";

export const alt = "sponsored spot on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

const PHOTO = { width: 560, height: 420 };

export default async function Image({ params }: { params: Promise<{ listing: string; index: string }> }) {
  const { listing: slug, index } = await params;
  const data = await fetchSponsoredSpot(slug, Number(index) - 1).catch(() => null);
  const [fonts, photo, logo] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(data?.listing.photos[0]?.url, PHOTO.width, PHOTO.height)),
    loadImage(cardPhoto(data?.brand.logoUrl, 96, 96)),
  ]);
  const surface = data ? SURFACE_LABELS[data.listing.surface].toLowerCase() : "ad space";
  const headline = data ? `${data.brand.name} sponsored @${data.listing.seller.handle}'s ${surface}` : "sponsored on adspaces";
  const place = data?.listing.audience.event ?? data?.listing.audience.location;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -220, top: -220, width: 700, height: 700, borderRadius: 700, background: og.accentSoft, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 60px 72px", width: 560 }}>
          <Brand size={44} />
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {logo && (
              <div style={{ display: "flex", width: 96, height: 96, borderRadius: 20, overflow: "hidden", background: og.surface, border: `1px solid ${og.line}` }}>
                {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements */}
                <img src={logo} width={96} height={96} alt="" style={{ objectFit: "contain", width: "100%", height: "100%" }} />
              </div>
            )}
            <div style={{ display: "flex", fontSize: 52, fontWeight: 700, color: og.ink, lineHeight: 1.08, letterSpacing: "-0.04em" }}>{truncate(headline, 70)}</div>
            {place && <div style={{ display: "flex", fontSize: 28, color: og.inkSoft }}>{truncate(`at ${place}`, 40)}</div>}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: og.muted }}>ad space on anything people see</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 24 }}>
          <MockupTile
            src={photo}
            width={PHOTO.width}
            height={PHOTO.height}
            rotate={-2}
            spots={(data?.listing.spots ?? []).map((spot) => ({ index: spot.index, layout: spot.layout, taken: spot.taken, highlight: spot.id === data?.spot.id }))}
          />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
