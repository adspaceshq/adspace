import { ImageResponse } from "next/og";
import { fetchPublicListing } from "@/lib/api/server";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { formatUsd } from "@/lib/money";
import { listingCardStats } from "@/lib/og/card-stats";
import { Avatar, Brand, Canvas, cardAvatar, cardLogo, cardPhoto, Dot, loadFonts, loadImage, loadLogo, MockupTile, og, OG_SIZE, Pill, StatTile, truncate, OG_CACHE_HEADERS } from "@/lib/og/kit";
import { spotsOnView } from "@/lib/spot-views";

export const alt = "adspaces listing";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 300;

const PHOTO = { width: 560, height: 420 };
const INNER_WIDTH = PHOTO.width - 16;

export default async function Image({ params }: { params: Promise<{ listing: string }> }) {
  const listing = await fetchPublicListing((await params).listing).catch(() => null);
  // The card shows the cover, so only the spots placed on the cover are drawn.
  const spots = spotsOnView(listing?.spots ?? [], 0, listing?.photos.length ?? 0);
  const [fonts, photo, avatar, ...logos] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(listing?.photos[0]?.url, PHOTO.width, PHOTO.height, "center")),
    loadImage(cardAvatar(listing?.seller.avatarUrl, 52)),
    // Sold spots and top bids show the sponsor's logo, like on the listing page.
    ...spots.map((spot) => loadLogo(cardLogo(spot.brand?.logoUrl, Math.round((spot.layout.w / 100) * INNER_WIDTH)))),
  ]);
  const stats = listing ? listingCardStats(listing) : null;
  const place = listing?.audience.event ?? listing?.audience.location;
  const title = truncate(listing?.title ?? "ad space on adspaces", 58);
  const titleSize = title.length > 36 ? 46 : title.length > 20 ? 58 : 72;

  return new ImageResponse(
    (
      <Canvas blob={{ size: 640, left: -220, bottom: -300 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: 580 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {listing && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: og.muted }}>
                <Avatar src={avatar} name={listing.seller.handle} size={44} />
                <div style={{ display: "flex", fontWeight: 600, color: og.inkSoft }}>{`@${truncate(listing.seller.handle, 22)}`}</div>
                <div style={{ display: "flex" }}>{`· ${SURFACE_LABELS[listing.surface]}`}</div>
              </div>
            )}
            <div style={{ display: "flex", fontSize: titleSize, fontWeight: 700, color: og.ink, lineHeight: 1.05, letterSpacing: "-0.045em" }}>{title}</div>
            {place && <div style={{ display: "flex", fontSize: 24, color: og.muted }}>{truncate(place, 42)}</div>}
          </div>
          {stats ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", gap: 14 }}>
                {stats.price ? (
                  <StatTile label={stats.price.label} value={formatUsd(stats.price.amount)} />
                ) : (
                  <StatTile label="spots" value={stats.spots ?? "all spots taken"} valueSize={36} />
                )}
                {stats.price && stats.spots && <StatTile label="spots" value={stats.spots} valueSize={stats.spots.length > 16 ? 26 : 32} flex={1} style={{ justifyContent: "space-between" }} />}
              </div>
              {stats.closing && (
                <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 600, color: stats.closing.urgent ? og.warning : og.inkSoft }}>
                  <Dot color={stats.closing.urgent ? og.warning : og.success} />
                  {stats.closing.text}
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 28, color: og.inkSoft }}>sell ad space on anything people see.</div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 32 }}>
          <MockupTile
            src={photo}
            width={PHOTO.width}
            height={PHOTO.height}
            rotate={2}
            spots={spots.map((spot, index) => ({ index: spot.index, layout: spot.layout, taken: spot.taken, logo: logos[index] }))}
          >
            {stats && stats.oversubscribed > 0 && (
              <Pill tone="success" size={28} style={{ position: "absolute", left: 18, bottom: 18, boxShadow: "0 10px 24px rgba(2, 8, 23, 0.3)" }}>
                {`+${stats.oversubscribed.toLocaleString("en-US")}% oversubscribed`}
              </Pill>
            )}
          </MockupTile>
        </div>
      </Canvas>
    ),
    { ...size, fonts, headers: OG_CACHE_HEADERS },
  );
}
