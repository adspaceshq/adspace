import { BadgeCheck, CalendarDays, Store } from "lucide-react";
import type { ProfilePage } from "@/lib/api/types";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListingCard } from "@/components/market/ListingCard";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { OwnerActions } from "./OwnerActions";

const SOCIAL_URL: Record<string, (handle: string) => string> = {
  x: (handle) => `https://x.com/${handle}`,
  instagram: (handle) => `https://instagram.com/${handle}`,
  tiktok: (handle) => `https://tiktok.com/@${handle}`,
  youtube: (handle) => `https://youtube.com/@${handle}`,
};
const SOCIAL_LABEL: Record<string, string> = { x: "X", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube" };

// Socials are free text; only plain handles become links.
function socialLink(platform: string, value: string) {
  const handle = value.trim().replace(/^@+/, "");
  return /^[A-Za-z0-9_.]{1,40}$/.test(handle) ? SOCIAL_URL[platform]?.(handle) : undefined;
}

export function ProfileView({ profile }: { profile: ProfilePage }) {
  const { stats } = profile;
  const tiles = [
    { label: "spots sold", value: stats.spotsSold.toLocaleString() },
    { label: "delivered on time", value: stats.onTimeRate === null ? "new" : `${Math.round(stats.onTimeRate * 100)}%`, hint: stats.deliveries ? `${stats.deliveries} deliveries` : undefined },
    { label: "spots sponsored", value: stats.spotsSponsored.toLocaleString() },
  ].filter((tile) => tile.label !== "spots sponsored" || stats.spotsSponsored > 0);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-5 sm:flex-row sm:items-start">
        <SellerAvatar seller={{ handle: profile.handle, displayName: profile.displayName, avatarUrl: profile.avatarUrl }} size={96} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="flex items-center gap-2 text-title font-semibold sm:text-display">
              {profile.displayName}
              {profile.verified && <BadgeCheck className="size-6 text-accent" aria-label="verified" />}
            </h1>
            <OwnerActions profileId={profile.id} />
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted">
            <span>@{profile.handle}</span>
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-4" aria-hidden /> joined {new Date(profile.memberSince).toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </span>
          </p>
          {profile.bio && <p className="max-w-2xl whitespace-pre-line text-body">{profile.bio}</p>}
          {Object.keys(profile.socials).length > 0 && (
            <ul className="flex flex-wrap gap-2 text-small">
              {Object.entries(profile.socials).map(([platform, value]) => {
                const href = socialLink(platform, value ?? "");
                const label = `${SOCIAL_LABEL[platform] ?? platform} ${value}`;
                return (
                  <li key={platform}>
                    {href ? (
                      <a href={href} target="_blank" rel="noreferrer nofollow" className="inline-flex rounded-full border border-line px-3 py-1 hover:border-line-strong">
                        {label}
                      </a>
                    ) : (
                      <span className="inline-flex rounded-full border border-line px-3 py-1">{label}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-card border border-line bg-surface p-4">
            <dt className="text-small text-muted">{tile.label}</dt>
            <dd className="text-title font-semibold tabular-nums">{tile.value}</dd>
            {tile.hint && <dd className="text-small text-subtle">{tile.hint}</dd>}
          </div>
        ))}
      </dl>

      <section className="flex flex-col gap-4">
        <h2 className="text-body font-semibold">listings</h2>
        {profile.listings.length === 0 ? (
          <EmptyState icon={Store} title="no listings yet" description={`@${profile.handle} hasn't listed any ad space yet.`} />
        ) : (
          <div className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {profile.listings.map((listing) => (
              <ListingCard key={listing.id} listing={listing} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
