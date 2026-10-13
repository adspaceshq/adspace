import { ImageResponse } from "next/og";
import { fetchProfilePage } from "@/lib/api/server";
import { Avatar, Brand, Canvas, cardAvatar, cardLogo, cardPhoto, Dot, loadFonts, loadImage, loadLogo, MockupTile, og, OG_SIZE, PhotoTile, Pill, StatTile, truncate, OG_CACHE_HEADERS } from "@/lib/og/kit";
import { spotsOnView } from "@/lib/spot-views";

export const alt = "adspaces profile";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

const FRONT = { width: 380, height: 290 };
const BACK = { width: 300, height: 230 };

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@+/, "");
  const profile = await fetchProfilePage(handle).catch(() => null);
  // Live listings first, so the photos show what can be sponsored right now.
  const listings = [...(profile?.listings ?? [])].filter((listing) => listing.photos[0]).sort((a, b) => Number(b.state === "published") - Number(a.state === "published")).slice(0, 2);
  const [front, back] = listings;
  const frontSpots = front ? spotsOnView(front.spots, 0, front.photos.length) : [];
  const [fonts, avatar, frontPhoto, backPhoto, ...logos] = await Promise.all([
    loadFonts(),
    loadImage(cardAvatar(profile?.avatarUrl, 132)),
    loadImage(cardPhoto(front?.photos[0]?.url, FRONT.width, FRONT.height, "center")),
    loadImage(cardPhoto(back?.photos[0]?.url, BACK.width, BACK.height)),
    ...frontSpots.map((spot) => loadLogo(cardLogo(spot.brand?.logoUrl, Math.round((spot.layout.w / 100) * FRONT.width)))),
  ]);
  const name = profile?.displayName || `@${handle}`;
  const nameSize = name.length > 14 ? 46 : 60;
  const stats = profile
    ? [
        { value: profile.stats.spotsSold.toLocaleString("en-US"), label: "spots sold" },
        { value: profile.stats.onTimeRate === null ? "new" : `${Math.round(profile.stats.onTimeRate * 100)}%`, label: "on time" },
        { value: profile.stats.activeListings.toLocaleString("en-US"), label: "live listings" },
      ]
    : [];
  const hasPhotos = Boolean(front);

  return new ImageResponse(
    (
      <Canvas blob={{ size: 620, right: -180, top: -200 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: hasPhotos ? 640 : 1060 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 26 }}>
              <Avatar src={avatar} name={name} size={132} ring={6} />
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: hasPhotos ? 420 : 820 }}>
                <div style={{ display: "flex", fontSize: nameSize, fontWeight: 700, color: og.ink, letterSpacing: "-0.045em", lineHeight: 1.02 }}>{truncate(name, 34)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ display: "flex", fontSize: 28, color: og.muted }}>{`@${truncate(profile?.handle ?? handle, profile?.verified ? 16 : 22)}`}</div>
                  {profile?.verified && (
                    <Pill tone="accent" size={18}>
                      verified
                    </Pill>
                  )}
                </div>
              </div>
            </div>
            {profile?.bio ? (
              <div style={{ display: "flex", fontSize: 26, color: og.inkSoft, lineHeight: 1.35, maxWidth: 540 }}>{truncate(profile.bio, 100)}</div>
            ) : (
              !profile && <div style={{ display: "flex", fontSize: 26, color: og.inkSoft }}>sells ad space on adspaces</div>
            )}
          </div>
          {stats.length > 0 ? (
            <div style={{ display: "flex", gap: 14 }}>
              {stats.map((stat) => (
                <StatTile key={stat.label} label={stat.label} value={stat.value} valueSize={40} style={{ minWidth: 150 }} />
              ))}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 24, color: og.muted }}>ad space on anything people see</div>
          )}
        </div>
        {hasPhotos && (
          <div style={{ display: "flex", position: "relative", flex: 1 }}>
            {back && <PhotoTile src={backPhoto} width={BACK.width} height={BACK.height} rotate={6} style={{ position: "absolute", left: 200, top: 70 }} />}
            <MockupTile
              src={frontPhoto}
              width={FRONT.width}
              height={FRONT.height}
              rotate={-3}
              spots={frontSpots.map((spot, index) => ({ index: spot.index, layout: spot.layout, taken: spot.taken, logo: logos[index] }))}
              style={{ position: "absolute", left: 40, top: back ? 250 : 170 }}
            >
              {front.state === "published" && (
                <Pill tone="soft" size={20} style={{ position: "absolute", left: 14, bottom: 14, boxShadow: "0 8px 20px rgba(2, 8, 23, 0.25)" }}>
                  <Dot color={og.success} size={10} />
                  {truncate(front.title, 26)}
                </Pill>
              )}
            </MockupTile>
          </div>
        )}
      </Canvas>
    ),
    { ...size, fonts, headers: OG_CACHE_HEADERS },
  );
}
