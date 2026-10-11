import type { Onboarding } from "@/lib/api/types";

export type Role = Onboarding["accountType"];
export const SOCIAL_PLATFORMS = ["x", "instagram", "tiktok", "youtube"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];
export const BRAND_CATEGORIES = ["crypto", "fintech", "gaming", "consumer", "saas", "fitness", "media", "other"] as const;

export interface RoleForm {
  role: Role | null;
  socials: Partial<Record<SocialPlatform, string>>;
  brandName: string;
  category: string;
  website: string;
}

export type RoleErrors = Partial<Record<"role" | "socials" | "brandName" | "category" | "website", string>>;

export const sells = (role: Role | null) => role === "creator" || role === "both";
export const sponsors = (role: Role | null) => role === "sponsor" || role === "both";

// Mirrors the backend handle rule so the form can answer before the network does.
export function handleError(handle: string): string | null {
  const clean = handle.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_]{3,30}$/.test(clean)) return "3-30 letters, numbers or underscores";
  return null;
}

export function buildOnboarding(form: RoleForm): { payload?: Onboarding; errors: RoleErrors } {
  const errors: RoleErrors = {};
  if (!form.role) return { errors: { role: "pick how you'll use adspaces" } };
  const socials: Partial<Record<SocialPlatform, string>> = {};
  for (const platform of SOCIAL_PLATFORMS) {
    const value = form.socials[platform]?.trim();
    if (value) socials[platform] = value;
  }
  if (sells(form.role) && Object.keys(socials).length === 0) errors.socials = "add at least one account so sponsors can check your reach";
  const brandName = form.brandName.trim();
  const website = form.website.trim();
  if (sponsors(form.role)) {
    if (!brandName) errors.brandName = "add your brand name";
    else if (brandName.length > 80) errors.brandName = "keep it under 80 characters";
    if (!form.category) errors.category = "pick a category";
    if (website && !/^https?:\/\/\S+\.\S+$/i.test(website)) errors.website = "use a full https:// link";
  }
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    payload: {
      accountType: form.role,
      ...(sells(form.role) ? { creator: { socials } } : {}),
      ...(sponsors(form.role) ? { sponsor: { brandName, category: form.category, ...(website ? { website } : {}) } } : {}),
    },
  };
}

// Where to land after setup: an explicit in-app `next`, else the dashboard for the chosen role.
export function landingPath(next: string | null, role: Role): string {
  // Browsers treat "/\" like "//", so backslashes are refused too.
  if (next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && !next.startsWith("/onboarding")) return next;
  return role === "sponsor" ? "/dashboard/sponsor" : role === "creator" ? "/dashboard/creator" : "/dashboard";
}
