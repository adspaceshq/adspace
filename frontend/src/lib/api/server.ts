import type { Post, ProfilePage, PublicListing, SponsoredSpot } from "./types";

const BASE = `${(process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "")}/api/v2`;

// Server-side reads for SEO and share previews; short revalidation keeps prices and spots fresh.
export async function fetchPublicListing(slug: string): Promise<PublicListing | null> {
  const response = await fetch(`${BASE}/listings/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`listing request failed (${response.status})`);
  return (await response.json()) as PublicListing;
}

export async function fetchProfilePage(handle: string): Promise<ProfilePage | null> {
  const response = await fetch(`${BASE}/users/${encodeURIComponent(handle)}/page`, { next: { revalidate: 60 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`profile request failed (${response.status})`);
  return (await response.json()) as ProfilePage;
}

export async function fetchSponsoredSpot(slug: string, index: number): Promise<SponsoredSpot | null> {
  const response = await fetch(`${BASE}/listings/${encodeURIComponent(slug)}/spots/${index}/sponsor`, { next: { revalidate: 300 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`sponsored spot request failed (${response.status})`);
  return (await response.json()) as SponsoredSpot;
}

// A single public post plus its listing, for post share links.
export async function fetchListingPost(slug: string, postId: string): Promise<{ listing: PublicListing; post: Post } | null> {
  const listing = await fetchPublicListing(slug);
  if (!listing) return null;
  const response = await fetch(`${BASE}/listings/${encodeURIComponent(listing.id)}/posts`, { next: { revalidate: 300 } });
  if (!response.ok) throw new Error(`posts request failed (${response.status})`);
  const post = ((await response.json()) as Post[]).find((item) => item.id === postId);
  return post ? { listing, post } : null;
}

export async function fetchBrowsePreview(): Promise<PublicListing[]> {
  const response = await fetch(`${BASE}/listings?limit=6&sort=newest`, { next: { revalidate: 600 } });
  if (!response.ok) return [];
  return ((await response.json()) as { items: PublicListing[] }).items;
}
