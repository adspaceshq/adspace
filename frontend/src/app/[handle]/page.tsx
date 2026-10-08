import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { AppShell } from "@/components/app/AppShell";
import { ProfileView } from "@/components/profile/ProfileView";
import { fetchProfilePage } from "@/lib/api/server";

type Params = Promise<{ handle: string }>;

const clean = (value: string) => decodeURIComponent(value).trim().replace(/^@+/, "");

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const profile = await fetchProfilePage(clean((await params).handle));
  if (!profile) return { title: "profile not found" };
  const { stats } = profile;
  const description =
    profile.bio ||
    [
      stats.spotsSold ? `${stats.spotsSold} ad spot${stats.spotsSold === 1 ? "" : "s"} sold` : null,
      stats.onTimeRate !== null ? `${Math.round(stats.onTimeRate * 100)}% delivered on time` : null,
      stats.activeListings ? `${stats.activeListings} live listing${stats.activeListings === 1 ? "" : "s"}` : null,
    ]
      .filter(Boolean)
      .join(" · ") ||
    `@${profile.handle} on adspaces`;
  return {
    title: `${profile.displayName} (@${profile.handle})`,
    description,
    alternates: { canonical: `/${profile.handle}` },
    openGraph: { type: "profile", title: `${profile.displayName} on adspaces`, description, url: `/${profile.handle}` },
  };
}

export default async function ProfilePage({ params }: { params: Params }) {
  const handle = clean((await params).handle);
  const profile = await fetchProfilePage(handle);
  if (!profile) notFound();
  if (handle !== profile.handle) permanentRedirect(`/${profile.handle}`);
  return (
    <AppShell variant="public">
      <ProfileView profile={profile} />
    </AppShell>
  );
}
