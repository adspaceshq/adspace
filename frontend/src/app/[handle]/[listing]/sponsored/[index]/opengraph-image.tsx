import { ImageResponse } from "next/og";
import { fetchSponsoredSpot } from "@/lib/api/server";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { Avatar, Brand, Canvas, cardAvatar, cardLogo, cardPhoto, fitLogo, loadFonts, loadImage, loadLogo, MockupTile, og, OG_SIZE, Pill, truncate, OG_CACHE_HEADERS } from "@/lib/og/kit";
import { spotsOnView, spotView } from "@/lib/spot-views";

export const alt = "sponsored spot on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

const PHOTO = { width: 560, height: 420 };
const INNER_WIDTH = PHOTO.width - 16;
const LOGO = 112;

export default async function Image({ params }: { params: Promise<{ listing: string; index: string }> }) {
  const { listing: slug, index } = await params;
  const data = await fetchSponsoredSpot(slug, Number(index) - 1).catch(() => null);
  const listing = data?.listing;
  const photoCount = listing?.photos.length ?? 0;
  // The card shows the photo the sponsored spot sits on, with the spots placed on that photo.
  const sponsored = listing?.spots.find((spot) => spot.id === data?.spot.id);
  const view = sponsored ? spotView(sponsored.layout, photoCount) : 0;
  const spots = spotsOnView(listing?.spots ?? [], view, photoCount);
  const stickerWidth = sponsored ? Math.round((sponsored.layout.w / 100) * INNER_WIDTH) : 96;
  const [fonts, photo, logo, sticker, avatar] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(listing?.photos[view]?.url ?? listing?.photos[0]?.url, PHOTO.width, PHOTO.height, "center")),
    loadLogo(cardLogo(data?.brand.logoUrl, LOGO)),
    loadLogo(cardLogo(data?.brand.logoUrl, stickerWidth)),
    loadImage(cardAvatar(listing?.seller.avatarUrl, 52)),
  ]);
  const brandName = truncate(data?.brand.name ?? "a sponsor", 24);
  const nameSize = brandName.length > 16 ? 52 : brandName.length > 10 ? 64 : 76;
  const surface = listing ? SURFACE_LABELS[listing.surface] : "ad space";
  const place = listing?.audience.event ?? listing?.audience.location;
  const logoBox = logo ? fitLogo(logo.aspect, LOGO, LOGO) : null;

  return new ImageResponse(
    (
      <Canvas blob={{ size: 700, right: -240, top: -240 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: 580 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex" }}>
              <Pill tone="accent" size={22}>
                sponsored by
              </Pill>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              {logo && logoBox ? (
                <div style={{ display: "flex", width: logoBox.width, height: logoBox.height, borderRadius: 22, overflow: "hidden", boxShadow: "0 14px 30px -8px rgba(2, 8, 23, 0.35)", flexShrink: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements */}
                  <img src={logo.src} width={logoBox.width} height={logoBox.height} alt="" style={{ width: logoBox.width, height: logoBox.height, objectFit: "cover" }} />
                </div>
              ) : (
                data && (
                  // No logo: a monogram in the brand's place, so the card still reads as a brand.
                  <div style={{ display: "flex", width: 96, height: 96, borderRadius: 22, background: og.ink, color: og.surface, alignItems: "center", justifyContent: "center", fontSize: 52, fontWeight: 700, flexShrink: 0 }}>
                    {brandName.slice(0, 1).toUpperCase()}
                  </div>
                )
              )}
              <div style={{ display: "flex", fontSize: nameSize, fontWeight: 700, color: og.ink, lineHeight: 1.02, letterSpacing: "-0.045em" }}>{brandName}</div>
            </div>
            <div style={{ display: "flex", fontSize: 32, fontWeight: 600, color: og.inkSoft, lineHeight: 1.25, letterSpacing: "-0.02em" }}>
              {listing ? `on @${truncate(listing.seller.handle, 20)}'s ${surface}` : "on adspaces"}
            </div>
          </div>
          {listing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Avatar src={avatar} name={listing.seller.handle} size={52} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: og.ink }}>{truncate(listing.title, 34)}</div>
                <div style={{ display: "flex", fontSize: 20, color: og.muted }}>{place ? truncate(`${listing.seller.displayName} · ${place}`, 44) : truncate(listing.seller.displayName, 44)}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 24, color: og.muted }}>ad space on anything people see</div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 32 }}>
          <MockupTile
            src={photo}
            width={PHOTO.width}
            height={PHOTO.height}
            spots={spots.map((spot) => {
              const mine = spot.id === data?.spot.id;
              return { index: spot.index, layout: spot.layout, taken: spot.taken, highlight: mine, logo: mine ? sticker : null };
            })}
          />
        </div>
      </Canvas>
    ),
    { ...size, fonts, headers: OG_CACHE_HEADERS },
  );
}
