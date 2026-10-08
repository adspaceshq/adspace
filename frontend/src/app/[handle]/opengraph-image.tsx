import { ImageResponse } from "next/og";
import { fetchProfilePage } from "@/lib/api/server";
import { Brand, cardPhoto, loadFonts, loadImage, og, OG_SIZE, PhotoTile, truncate } from "@/lib/og/kit";

export const alt = "adspaces profile";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 3600;

export default async function Image({ params }: { params: Promise<{ handle: string }> }) {
  const handle = decodeURIComponent((await params).handle).replace(/^@+/, "");
  const profile = await fetchProfilePage(handle).catch(() => null);
  const photos = (profile?.listings ?? []).map((listing) => listing.photos[0]?.url).filter(Boolean).slice(0, 2);
  const [fonts, avatar, first, second] = await Promise.all([
    loadFonts(),
    loadImage(cardPhoto(profile?.avatarUrl, 160, 160)),
    loadImage(cardPhoto(photos[0], 300, 360)),
    loadImage(cardPhoto(photos[1], 260, 320)),
  ]);
  const name = profile?.displayName ?? `@${handle}`;
  const stats = profile
    ? [
        { value: profile.stats.spotsSold.toLocaleString("en-US"), label: "spots sold" },
        { value: profile.stats.onTimeRate === null ? "new" : `${Math.round(profile.stats.onTimeRate * 100)}%`, label: "on time" },
        { value: profile.stats.activeListings.toLocaleString("en-US"), label: "live listings" },
      ]
    : [];

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -160, top: -160, width: 600, height: 600, borderRadius: 600, background: og.accentSoft, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "72px 0 64px 80px", width: photos.length ? 700 : 1040 }}>
          <Brand size={48} />
          <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
              <div style={{ display: "flex", width: 140, height: 140, borderRadius: 140, overflow: "hidden", border: `6px solid ${og.surface}`, background: og.accent, alignItems: "center", justifyContent: "center" }}>
                {avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Satori renders plain img elements
                  <img src={avatar} width={140} height={140} alt="" style={{ objectFit: "cover", width: "100%", height: "100%" }} />
                ) : (
                  <div style={{ display: "flex", fontSize: 64, fontWeight: 700, color: og.surface }}>{name.replace(/^@/, "").slice(0, 1).toUpperCase()}</div>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 60, fontWeight: 700, color: og.ink, letterSpacing: "-0.04em", lineHeight: 1.05 }}>{truncate(name, 22)}</div>
                <div style={{ fontSize: 30, color: og.muted }}>@{truncate(profile?.handle ?? handle, 28)}</div>
              </div>
            </div>
            {profile?.bio && <div style={{ fontSize: 28, color: og.inkSoft, lineHeight: 1.35, maxWidth: 580 }}>{truncate(profile.bio, 110)}</div>}
          </div>
          <div style={{ display: "flex", gap: 48 }}>
            {stats.map((stat) => (
              <div key={stat.label} style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ fontSize: 44, fontWeight: 700, color: og.ink }}>{stat.value}</div>
                <div style={{ fontSize: 22, color: og.muted }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
        {photos.length > 0 && (
          <div style={{ display: "flex", position: "relative", flex: 1 }}>
            <PhotoTile src={first} width={300} height={360} rotate={-4} style={{ position: "absolute", left: 30, top: 90 }} />
            {photos[1] && <PhotoTile src={second} width={260} height={320} rotate={5} style={{ position: "absolute", left: 200, top: 230 }} />}
          </div>
        )}
      </div>
    ),
    { ...size, fonts },
  );
}
