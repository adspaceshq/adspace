"use client";

import { safeHref } from "@/lib/safe-href";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Bookmark, ExternalLink, Eye, Heart, MessageCircle, Repeat2, type LucideIcon } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { Post, PostKind, PublicSpot } from "@/lib/api/types";
import { queryKeys } from "@/lib/query";
import { cx } from "@/lib/cx";
import { Skeleton, SkeletonGroup } from "@/components/ui/Skeleton";

const SOURCE: Partial<Record<PostKind, string>> = {
  x: "X",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  link: "link",
};

const compact = (value: number) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(1)}m` : value >= 1_000 ? `${(value / 1_000).toFixed(1)}k` : String(value);

const relative = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h`;
  return `${Math.round(minutes / 1440)}d`;
};

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function Metric({ icon: Icon, value, label }: { icon: LucideIcon; value: number | null; label: string }) {
  if (value === null) return null;
  return (
    <span className="inline-flex items-center gap-1" title={`${value.toLocaleString()} ${label}`}>
      <Icon className="size-3.5" aria-hidden />
      <span className="tabular-nums">{compact(value)}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PostCard({ post, spots }: { post: Post; spots: Pick<PublicSpot, "id" | "index">[] }) {
  const proofSpots = spots.filter((spot) => post.proofForSpotIds.includes(spot.id));
  const source = SOURCE[post.kind];
  return (
    <article className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <header className="flex items-center gap-2 text-small text-muted">
        {post.kind === "x" ? <XMark className="size-3.5 text-ink" /> : null}
        <span>{source ? `on ${source}` : "update"}</span>
        <span aria-hidden>·</span>
        <time dateTime={post.createdAt} title={new Date(post.createdAt).toLocaleString()}>
          {relative(post.createdAt)}
        </time>
        {proofSpots.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-caption font-medium text-success">
            <BadgeCheck className="size-3" aria-hidden />
            proof for spot {proofSpots.map((spot) => spot.index + 1).join(", ")}
          </span>
        )}
      </header>
      {post.body && <p className="whitespace-pre-line text-body">{post.body}</p>}
      {post.media.length > 0 && (
        <div className={cx("grid gap-2", post.media.length > 1 && "grid-cols-2")}>
          {post.media.map((media) => (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary-hosted post photos
            <img key={media.url} src={media.url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-control object-cover" />
          ))}
        </div>
      )}
      {post.url && (
        <a
          href={safeHref(post.url)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 self-start text-small font-medium text-accent hover:underline"
        >
          {source && post.kind !== "link" ? `open on ${source}` : new URL(post.url).hostname.replace(/^www\./, "")}
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
      )}
      {post.metrics && (
        <footer className="flex flex-wrap items-center gap-4 border-t border-line pt-3 text-small text-muted">
          <Metric icon={Eye} value={post.metrics.views} label="views" />
          <Metric icon={Heart} value={post.metrics.likes} label="likes" />
          <Metric icon={Repeat2} value={post.metrics.reposts} label="reposts" />
          <Metric icon={MessageCircle} value={post.metrics.replies} label="replies" />
          <Metric icon={Bookmark} value={post.metrics.bookmarks} label="bookmarks" />
        </footer>
      )}
    </article>
  );
}

export function PostFeed({ listingId, spots }: { listingId: string; spots: Pick<PublicSpot, "id" | "index">[] }) {
  const query = useQuery({ queryKey: queryKeys.posts(listingId), queryFn: () => api.listings.posts(listingId) });
  const posts = query.data ?? [];
  const totalViews = posts.reduce((sum, post) => sum + (post.metrics?.views ?? 0), 0);

  return (
    <section aria-labelledby="updates" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="updates" className="text-lead font-semibold">
          updates &amp; proof
        </h2>
        {posts.length > 0 && (
          <p className="text-small text-muted">
            {posts.length} post{posts.length === 1 ? "" : "s"}
            {totalViews > 0 && ` · ${compact(totalViews)} views`}
          </p>
        )}
      </div>
      {query.isPending ? (
        <SkeletonGroup label="loading updates">
          <div className="flex flex-col gap-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        </SkeletonGroup>
      ) : query.isError ? (
        <p className="text-small text-muted">updates couldn&apos;t load right now.</p>
      ) : posts.length === 0 ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-small text-muted">
          the creator will post updates and proof of delivery here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} spots={spots} />
          ))}
        </div>
      )}
    </section>
  );
}
