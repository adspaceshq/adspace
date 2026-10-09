import { ImageResponse } from "next/og";
import { fetchPublicListing } from "@/lib/api/server";
import { priceSummary, spotsLeft } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";
import { Brand, cardPhoto, loadFonts, loadImage, MockupTile, og, OG_SIZE, truncate, OG_CACHE_HEADERS } from "@/lib/og/kit";

export const alt = "adspaces listing";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

const PHOTO = { width: 560, height: 420 };

export default async function Image({ params }: { params: Promise<{ listing: string }> }) {
  const listing = await fetchPublicListing((await params).listing).catch(() => null);
  const [fonts, photo, avatar] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(listing?.photos[0]?.url, PHOTO.width, PHOTO.height)),
    loadImage(cardPhoto(listing?.seller.avatarUrl, 64, 64)),
  ]);
  const price = listing ? priceSummary(listing) : null;
  const left = listing ? spotsLeft(listing) : 0;
  const total = listing?.spots.length ?? 0;
  const place = listing?.audience.event ?? listing?.audience.location;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: -200, bottom: -260, width: 640, height: 640, borderRadius: 640, background: og.accentSoft, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 60px 72px", width: 560 }}>
          <Brand size={44} />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {listing && (
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ display: "flex", width: 52, height: 52, borderRadius: 52, overflow: "hidden", background: og.accent, alignItems: "center", justifyContent: "center", color: og.surface, fontSize: 24, fontWeight: 700 }}>
                  {avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
                    <img src={avatar} width={52} height={52} alt="" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                  ) : (
                    listing.seller.handle.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div style={{ fontSize: 26, color: og.muted }}>{`@${truncate(listing.seller.handle, 24)}`}</div>
              </div>
            )}
            <div style={{ fontSize: 54, fontWeight: 700, color: og.ink, lineHeight: 1.08, letterSpacing: "-0.04em" }}>
              {truncate(listing?.title ?? "ad space on adspaces", 60)}
            </div>
            {place && <div style={{ fontSize: 26, color: og.inkSoft }}>{truncate(place, 40)}</div>}
          </div>
          <div style={{ display: "flex", gap: 40, alignItems: "flex-end" }}>
            {!listing ? (
              <div style={{ fontSize: 30, color: og.inkSoft }}>sell ad space on anything people see.</div>
            ) : price ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 22, color: og.muted }}>{price.label}</div>
                <div style={{ fontSize: 48, fontWeight: 700, color: og.ink }}>{formatUsd(price.amount)}</div>
              </div>
            ) : (
              <div style={{ fontSize: 34, fontWeight: 700, color: og.ink }}>all spots taken</div>
            )}
            {total > 0 && (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 22, color: og.muted }}>spots</div>
                <div style={{ fontSize: 48, fontWeight: 700, color: og.ink }}>{left ? `${left} of ${total} left` : `${total} sold`}</div>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 24 }}>
          <MockupTile
            src={photo}
            width={PHOTO.width}
            height={PHOTO.height}
            rotate={2}
            spots={(listing?.spots ?? []).map((spot) => ({ index: spot.index, layout: spot.layout, taken: spot.taken }))}
          />
        </div>
      </div>
    ),
    { ...size, fonts, headers: OG_CACHE_HEADERS },
  );
}
