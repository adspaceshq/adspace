import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { fetchListingPost } from "@/lib/api/server";
import { listingHref } from "@/lib/listing-display";
import { headlineMetric, POST_SOURCE } from "@/lib/post-display";

type Params = Promise<{ handle: string; listing: string; postId: string }>;

const clean = (value: string) => decodeURIComponent(value).trim().replace(/^@+/, "").toLowerCase();

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { listing: slug, postId } = await params;
  const data = await fetchListingPost(slug, postId);
  if (!data) return { title: "post not found" };
  const metric = headlineMetric(data.post.metrics);
  const title = metric ? `${metric.value} ${metric.label} on @${data.listing.seller.handle}'s ${data.listing.title}` : `@${data.listing.seller.handle} on ${data.listing.title}`;
  const description = data.post.body.slice(0, 200) || `a ${POST_SOURCE[data.post.kind]} post from an adspaces listing`;
  return { title, description, openGraph: { title, description }, robots: { index: false } };
}

export default async function PostPage({ params }: { params: Params }) {
  const { handle, listing: slug, postId } = await params;
  const data = await fetchListingPost(slug, postId);
  if (!data) notFound();
  const { listing, post } = data;
  if (clean(handle) !== listing.seller.handle.toLowerCase()) permanentRedirect(`${listingHref(listing.seller.handle, listing.slug)}/posts/${post.id}`);
  const metric = headlineMetric(post.metrics);
  const photo = post.media[0]?.url ?? listing.photos[0]?.url;

  return (
    <AppShell variant="public">
      <article className="mx-auto flex max-w-2xl flex-col gap-5">
        <Link href={`/${listing.seller.handle}`} className="flex items-center gap-3 self-start">
          <SellerAvatar seller={listing.seller} size={40} />
          <div>
            <p className="text-body font-semibold">{listing.seller.displayName}</p>
            <p className="text-small text-muted">
              @{listing.seller.handle} · {new Date(post.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
            </p>
          </div>
        </Link>
        {metric && (
          <p className="text-title font-semibold">
            {metric.value} <span className="text-muted">{metric.label}</span>
          </p>
        )}
        {post.body && <p className="whitespace-pre-line text-body">{post.body}</p>}
        {photo && (
          // eslint-disable-next-line @next/next/no-img-element -- user media from Cloudinary
          <img src={photo} alt="" className="w-full rounded-panel border border-line object-cover" />
        )}
        <div className="flex flex-wrap gap-2">
          {post.url && (
            <a href={post.url} target="_blank" rel="noreferrer nofollow" className="inline-flex items-center gap-1.5 rounded-control border border-line px-4 py-2 text-small font-medium hover:border-line-strong">
              open on {POST_SOURCE[post.kind]} <ExternalLink className="size-3.5" aria-hidden />
            </a>
          )}
          <Link href={listingHref(listing.seller.handle, listing.slug)} className="rounded-control bg-ink px-4 py-2 text-small font-medium text-white hover:bg-ink/90">
            see the listing
          </Link>
        </div>
      </article>
    </AppShell>
  );
}
