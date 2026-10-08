import { describe, expect, it } from "vitest";
import { buildOnboarding, handleError, landingPath, type RoleForm } from "./onboarding";

const base: RoleForm = { role: null, socials: {}, brandName: "", category: "", website: "" };

describe("onboarding", () => {
  it("requires the fields each role needs", () => {
    expect(buildOnboarding(base).errors.role).toBeDefined();
    expect(buildOnboarding({ ...base, role: "creator" }).errors.socials).toBeDefined();
    const sponsor = buildOnboarding({ ...base, role: "sponsor", website: "acme" }).errors;
    expect(Object.keys(sponsor).sort()).toEqual(["brandName", "category", "website"]);
  });

  it("builds a both payload with trimmed values only for filled fields", () => {
    const { payload } = buildOnboarding({ role: "both", socials: { x: " @bo ", tiktok: " " }, brandName: " Acme ", category: "saas", website: "" });
    expect(payload).toEqual({ accountType: "both", creator: { socials: { x: "@bo" } }, sponsor: { brandName: "Acme", category: "saas" } });
  });

  it("validates handles and picks a safe landing path", () => {
    expect(handleError("@bo_rides")).toBeNull();
    expect(handleError("ab")).not.toBeNull();
    expect(handleError("a b c")).not.toBeNull();
    expect(landingPath("/browse?q=car", "sponsor")).toBe("/browse?q=car");
    expect(landingPath("//evil.com", "creator")).toBe("/dashboard/creator");
    expect(landingPath(null, "sponsor")).toBe("/dashboard/sponsor");
    expect(landingPath("/onboarding", "both")).toBe("/dashboard");
  });
});
