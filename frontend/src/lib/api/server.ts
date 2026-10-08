import type { PublicListing } from "./types";

const BASE = `${(process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080").replace(/\/$/, "")}/api/v2`;

// Server-side reads for SEO and share previews; short revalidation keeps prices and spots fresh.
export async function fetchPublicListing(slug: string): Promise<PublicListing | null> {
  const response = await fetch(`${BASE}/listings/${encodeURIComponent(slug)}`, { next: { revalidate: 30 } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`listing request failed (${response.status})`);
  return (await response.json()) as PublicListing;
}
