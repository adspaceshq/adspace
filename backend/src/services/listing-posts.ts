import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { listingPosts, listings, mediaAssets, postMedia, postMetrics, spotProofPosts } from "../db/schema.js";

export class PostError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type PostKind = (typeof listingPosts.$inferInsert)["kind"];
type MetricsSource = (typeof postMetrics.$inferInsert)["source"];

export interface Actor {
  id: string;
  isReviewer: boolean;
}

const MAX_BODY = 1000;
const MAX_MEDIA = 4;

const patterns: Array<{ kind: PostKind; host: RegExp; id: RegExp }> = [
  { kind: "x", host: /^(www\.|mobile\.)?(x|twitter)\.com$/, id: /^\/[^/]+\/status\/(\d+)/ },
  { kind: "instagram", host: /^(www\.)?instagram\.com$/, id: /^\/(?:p|reel|reels)\/([\w-]+)/ },
  { kind: "tiktok", host: /^(www\.|m\.)?tiktok\.com$/, id: /\/video\/(\d+)/ },
  { kind: "youtube", host: /^(www\.|m\.)?youtube\.com$/, id: /^\/(?:shorts\/([\w-]+)|watch)/ },
  { kind: "youtube", host: /^youtu\.be$/, id: /^\/([\w-]+)/ },
];

// Recognises social posts so we can embed them and later pull their metrics.
export function classifyLink(raw: string): { kind: PostKind; url: string; externalId?: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new PostError("that doesn't look like a link");
  }
  if (url.protocol !== "https:") throw new PostError("links must use https");
  if (url.href.length > 500) throw new PostError("link is too long");
  const host = url.hostname.toLowerCase();
  for (const pattern of patterns) {
    if (!pattern.host.test(host)) continue;
    const match = pattern.id.exec(url.pathname);
    if (!match) continue;
    const externalId = match[1] ?? (pattern.kind === "youtube" ? url.searchParams.get("v") ?? undefined : undefined);
    return { kind: pattern.kind, url: url.href, ...(externalId ? { externalId } : {}) };
  }
  return { kind: "link", url: url.href };
}

async function loadListing(db: Db, listingId: string) {
  const [listing] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!listing) throw new PostError("listing not found", 404);
  return listing;
}

function assertCanPost(listing: { sellerId: string; state: string }, actor: Actor) {
  if (listing.sellerId !== actor.id && !actor.isReviewer) {
    throw new PostError("only the creator can post updates here", 403);
  }
  if (listing.state !== "published" && listing.state !== "closed") {
    throw new PostError("you can post once the listing is live", 409);
  }
}

export async function createPost(
  db: Db,
  actor: Actor,
  listingId: string,
  input: { url?: string; body?: string; mediaAssetIds?: string[] },
) {
  const listing = await loadListing(db, listingId);
  assertCanPost(listing, actor);
  const body = (input.body ?? "").trim();
  if (body.length > MAX_BODY) throw new PostError(`keep posts under ${MAX_BODY} characters`);
  const mediaIds = [...new Set(input.mediaAssetIds ?? [])];
  if (mediaIds.length > MAX_MEDIA) throw new PostError(`attach at most ${MAX_MEDIA} photos`);
  const link = input.url?.trim() ? classifyLink(input.url) : undefined;
  if (!link && !body && mediaIds.length === 0) throw new PostError("add a link, some text, or a photo");

  if (mediaIds.length > 0) {
    const owned = await db
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(and(inArray(mediaAssets.id, mediaIds), eq(mediaAssets.ownerId, actor.id), eq(mediaAssets.kind, "post_media")));
    if (owned.length !== mediaIds.length) throw new PostError("one of the photos isn't yours or doesn't exist");
  }

  const kind: PostKind = link?.kind ?? (mediaIds.length > 0 ? "photo" : "text");
  return db.transaction(async (trx) => {
    const [post] = await trx
      .insert(listingPosts)
      .values({ listingId, authorId: actor.id, kind, url: link?.url, externalId: link?.externalId, body })
      .returning();
    if (mediaIds.length > 0) {
      await trx.insert(postMedia).values(mediaIds.map((assetId, position) => ({ postId: post.id, assetId, position })));
    }
    return post;
  });
}

export async function deletePost(db: Db, actor: Actor, postId: string) {
  const [post] = await db.select().from(listingPosts).where(eq(listingPosts.id, postId));
  if (!post || post.deletedAt) throw new PostError("post not found", 404);
  if (post.authorId !== actor.id && !actor.isReviewer) throw new PostError("you can't delete this post", 403);
  const [proof] = await db.select().from(spotProofPosts).where(eq(spotProofPosts.postId, postId)).limit(1);
  if (proof) throw new PostError("this post is delivery proof and can't be removed", 409);
  await db.update(listingPosts).set({ deletedAt: new Date() }).where(eq(listingPosts.id, postId));
}

export async function recordMetrics(
  db: Db,
  postId: string,
  source: MetricsSource,
  numbers: { views?: number; likes?: number; reposts?: number; replies?: number; bookmarks?: number },
) {
  for (const value of Object.values(numbers)) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new PostError("metrics must be whole numbers");
  }
  const [row] = await db.insert(postMetrics).values({ postId, source, ...numbers }).returning();
  return row;
}

// Public feed: newest first, with photos, latest metrics, and which spots each post proves.
export async function listPosts(db: Db, listingId: string) {
  const posts = await db
    .select()
    .from(listingPosts)
    .where(and(eq(listingPosts.listingId, listingId), isNull(listingPosts.deletedAt)))
    .orderBy(desc(listingPosts.createdAt));
  if (posts.length === 0) return [];
  const ids = posts.map((post) => post.id);
  const [media, metrics, proofs] = await Promise.all([
    db
      .select({ postId: postMedia.postId, url: mediaAssets.url, width: mediaAssets.width, height: mediaAssets.height })
      .from(postMedia)
      .innerJoin(mediaAssets, eq(mediaAssets.id, postMedia.assetId))
      .where(inArray(postMedia.postId, ids))
      .orderBy(asc(postMedia.position)),
    db.select().from(postMetrics).where(inArray(postMetrics.postId, ids)).orderBy(desc(postMetrics.capturedAt)),
    db.select().from(spotProofPosts).where(inArray(spotProofPosts.postId, ids)),
  ]);
  return posts.map((post) => {
    const latest = metrics.find((metric) => metric.postId === post.id);
    return {
      id: post.id,
      kind: post.kind,
      url: post.url,
      externalId: post.externalId,
      body: post.body,
      createdAt: post.createdAt,
      authorId: post.authorId,
      media: media.filter((item) => item.postId === post.id).map(({ postId: _postId, ...item }) => item),
      metrics: latest
        ? {
            views: latest.views,
            likes: latest.likes,
            reposts: latest.reposts,
            replies: latest.replies,
            bookmarks: latest.bookmarks,
            source: latest.source,
            capturedAt: latest.capturedAt,
          }
        : null,
      proofForSpotIds: proofs.filter((proof) => proof.postId === post.id).map((proof) => proof.spotId),
    };
  });
}
