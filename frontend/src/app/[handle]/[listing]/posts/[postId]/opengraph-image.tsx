import { ImageResponse } from "next/og";
import { fetchListingPost } from "@/lib/api/server";
import { headlineMetric, POST_SOURCE } from "@/lib/post-display";
import { Brand, cardPhoto, loadFonts, loadImage, og, OG_SIZE, PhotoTile, truncate } from "@/lib/og/kit";

export const alt = "post on adspaces";
export const size = OG_SIZE;
export const contentType = "image/png";
export const revalidate = 900;

export default async function Image({ params }: { params: Promise<{ listing: string; postId: string }> }) {
  const { listing: slug, postId } = await params;
  const data = await fetchListingPost(slug, postId).catch(() => null);
  const [fonts, photo] = await Promise.all([loadFonts(), loadImage(cardPhoto(data?.post.media[0]?.url ?? data?.listing.photos[0]?.url, 440, 500))]);
  const metric = data ? headlineMetric(data.post.metrics) : null;
  const headline = data ? `@${data.listing.seller.handle}'s ${data.listing.title}` : "on adspaces";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: og.canvas, fontFamily: "Inter", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: -180, top: -220, width: 620, height: 620, borderRadius: 620, background: og.accentSoft, display: "flex" }} />
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "64px 0 60px 72px", width: 660 }}>
          <Brand size={44} />
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            {metric ? (
              <div style={{ display: "flex", alignItems: "baseline", gap: 18 }}>
                <div style={{ display: "flex", fontSize: 120, fontWeight: 700, color: og.ink, letterSpacing: "-0.05em", lineHeight: 1 }}>{metric.value}</div>
                <div style={{ display: "flex", fontSize: 44, fontWeight: 600, color: og.accent }}>{metric.label}</div>
              </div>
            ) : (
              <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: og.accent }}>{data ? `new ${POST_SOURCE[data.post.kind]} post` : "a post"}</div>
            )}
            <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: og.ink, lineHeight: 1.1, letterSpacing: "-0.03em" }}>{truncate(headline, 64)}</div>
            {data?.post.body && <div style={{ display: "flex", fontSize: 26, color: og.inkSoft, lineHeight: 1.35 }}>{truncate(data.post.body, 110)}</div>}
          </div>
          <div style={{ display: "flex", fontSize: 24, color: og.muted }}>ad space on anything people see</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", paddingRight: 40 }}>
          <PhotoTile src={photo} width={400} height={460} rotate={3} />
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
