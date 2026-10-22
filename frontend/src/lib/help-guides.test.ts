import { describe, expect, it } from "vitest";
import { HELP_GUIDES, HELP_TOPICS } from "./help-guides";

describe("help guides", () => {
  it("have unique ids, so /help#<id> deep links are unambiguous", () => {
    const ids = HELP_GUIDES.map((guide) => guide.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });

  it("cover every listed topic", () => {
    for (const { topic } of HELP_TOPICS) expect(HELP_GUIDES.some((guide) => guide.topic === topic)).toBe(true);
  });

  it("link only to app paths or full https addresses", () => {
    for (const link of HELP_GUIDES.flatMap((guide) => guide.links ?? [])) {
      expect(link.href.startsWith("/") || link.href.startsWith("https://")).toBe(true);
      expect(link.label.length).toBeGreaterThan(0);
    }
  });
});
