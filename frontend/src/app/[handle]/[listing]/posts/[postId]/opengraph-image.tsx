import { ImageResponse } from "next/og";
import { fetchListingPost } from "@/lib/api/server";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { compactCount, headlineMetric, POST_SOURCE } from "@/lib/post-display";
import { Avatar, Brand, Canvas, cardAvatar, cardLogo, cardPhoto, loadFonts, loadImage, loadLogo, MockupTile, og, OG_SIZE, PhotoTile, Pill, truncate, OG_CACHE_HEADERS } from "@/lib/og/kit";
import { spotsOnView } from "@/lib/spot-views";

export const alt = "post on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 900;

const MEDIA = { width: 420, height: 480 };
const COVER = { width: 520, height: 390 };

export default async function Image({ params }: { params: Promise<{ listing: string; postId: string }> }) {
  const { listing: slug, postId } = await params;
  const data = await fetchListingPost(slug, postId).catch(() => null);
  const listing = data?.listing;
  const post = data?.post;
  // The post's own media when it has some, else the listing cover with its spots, as on the post page.
  const media = post?.media[0]?.url;
  const coverSpots = !media && listing ? spotsOnView(listing.spots, 0, listing.photos.length) : [];
  const [fonts, photo, avatar, ...logos] = await Promise.all([
    loadFonts(),
    media ? loadImage(cardPhoto(media, MEDIA.width, MEDIA.height)) : loadImage(cardPhoto(listing?.photos[0]?.url, COVER.width, COVER.height, "center")),
    loadImage(cardAvatar(listing?.seller.avatarUrl, 56)),
    ...coverSpots.map((spot) => loadLogo(cardLogo(spot.brand?.logoUrl, Math.round((spot.layout.w / 100) * COVER.width)))),
  ]);
  const metric = post ? headlineMetric(post.metrics) : null;
  const extra = post?.metrics
    ? (
        [
          ["likes", post.metrics.likes],
          ["reposts", post.metrics.reposts],
          ["replies", post.metrics.replies],
        ] as const
      )
        .filter(([label, value]) => label !== metric?.label && typeof value === "number" && value > 0)
        .slice(0, 2)
        .map(([label, value]) => `${compactCount(value as number)} ${label}`)
    : [];
  const body = post?.body.trim() ? truncate(post.body, metric ? 90 : 120) : null;
  const bodySize = !body || body.length > 70 ? 34 : body.length > 26 ? 46 : 64;
  const date = post ? new Date(post.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;

  return new ImageResponse(
    (
      <Canvas blob={{ size: 620, left: -200, top: -240 }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "56px 0 56px 72px", width: media ? 660 : 600 }}>
          <Brand size={40} />
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div style={{ display: "flex" }}>
              <Pill tone="accent" size={20}>
                {post ? (post.kind === "text" ? "update" : `${POST_SOURCE[post.kind]} post`) : "post"}
              </Pill>
            </div>
            {metric && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
                <div style={{ display: "flex", fontSize: 112, fontWeight: 700, color: og.ink, letterSpacing: "-0.05em", lineHeight: 1 }}>{metric.value}</div>
                <div style={{ display: "flex", fontSize: 40, fontWeight: 600, color: og.accent }}>{metric.label}</div>
              </div>
            )}
            {body ? (
              <div style={{ display: "flex", fontSize: metric ? 30 : bodySize, fontWeight: metric ? 400 : 700, color: metric ? og.inkSoft : og.ink, lineHeight: 1.18, letterSpacing: metric ? "-0.01em" : "-0.035em" }}>
                {metric ? body : `“${body}”`}
              </div>
            ) : (
              !metric && <div style={{ display: "flex", fontSize: 46, fontWeight: 700, color: og.ink, letterSpacing: "-0.035em", lineHeight: 1.1 }}>{listing ? truncate(listing.title, 60) : "on adspaces"}</div>
            )}
            {extra.length > 0 && <div style={{ display: "flex", fontSize: 24, fontWeight: 600, color: og.muted }}>{extra.join(" · ")}</div>}
          </div>
          {listing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Avatar src={avatar} name={listing.seller.handle} size={56} />
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ display: "flex", fontSize: 24, fontWeight: 700, color: og.ink }}>{`@${truncate(listing.seller.handle, 22)}${date ? ` · ${date}` : ""}`}</div>
                <div style={{ display: "flex", fontSize: 20, color: og.muted }}>{truncate(`${listing.title} · ${SURFACE_LABELS[listing.surface]}`, 46)}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 24, color: og.muted }}>ad space on anything people see</div>
          )}
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 32 }}>
          {media ? (
            <PhotoTile src={photo} width={MEDIA.width} height={MEDIA.height} rotate={3} />
          ) : (
            <MockupTile
              src={photo}
              width={COVER.width}
              height={COVER.height}
              rotate={3}
              spots={coverSpots.map((spot, index) => ({ index: spot.index, layout: spot.layout, taken: spot.taken, logo: logos[index] }))}
            />
          )}
        </div>
      </Canvas>
    ),
    { ...size, fonts, headers: OG_CACHE_HEADERS },
  );
}
