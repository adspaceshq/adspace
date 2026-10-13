import { describe, expect, it } from "vitest";
import { detectMockup, mockupChoiceFor, mockupPresets, mockupUploaded, photoSourceFor, presetUrl, restorePresets } from "./mac-mockup";

const lid = { assetId: "a1", url: "https://x/1.png", preset: "lid-midnight" as const };
const inside = { assetId: "a2", url: "https://x/2.png", preset: "inside-midnight" as const };
const custom = { assetId: "a3", url: "https://x/3.jpg" };

describe("mac mockup", () => {
  it("builds original and thumbnail preset URLs", () => {
    expect(presetUrl("lid-silver")).toMatch(/^https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/adspaces\/static\/mac\/lid-silver\.png$/);
    expect(presetUrl("inside-midnight", 600)).toMatch(/\/image\/upload\/f_auto,q_auto,w_600\/adspaces\/static\/mac\/inside-midnight\.png$/);
  });

  it("lists the lid first and the keyboard deck second", () => {
    expect(mockupPresets({ color: "starlight", inside: false })).toEqual(["lid-starlight"]);
    expect(mockupPresets({ color: "starlight", inside: true })).toEqual(["lid-starlight", "inside-starlight"]);
  });

  it("knows when the chosen mockup is already uploaded", () => {
    expect(mockupUploaded([lid], { color: "midnight", inside: false })).toBe(true);
    expect(mockupUploaded([lid], { color: "silver", inside: false })).toBe(false);
    expect(mockupUploaded([lid], { color: "midnight", inside: true })).toBe(false);
    expect(mockupUploaded([lid, inside], { color: "midnight", inside: true })).toBe(true);
    expect(mockupUploaded([custom], { color: "midnight", inside: false })).toBe(false);
  });

  it("detects a mockup only when every photo is a preset", () => {
    expect(detectMockup([lid, inside])).toEqual({ color: "midnight", inside: true });
    expect(detectMockup([lid])).toEqual({ color: "midnight", inside: false });
    expect(detectMockup([lid, custom])).toBeNull();
    expect(detectMockup([custom])).toBeNull();
    expect(detectMockup([])).toBeNull();
  });

  it("picks the starting photo source for laptops only", () => {
    expect(photoSourceFor({ surface: "laptop", photos: [] })).toBe("mockup");
    expect(photoSourceFor({ surface: "laptop", photos: [lid] })).toBe("mockup");
    expect(photoSourceFor({ surface: "laptop", photos: [custom] })).toBe("upload");
    expect(photoSourceFor({ surface: "laptop", photos: [], photoSource: "upload" })).toBe("upload");
    expect(photoSourceFor({ surface: "tshirt", photos: [] })).toBe("upload");
    expect(mockupChoiceFor({ photos: [lid] })).toEqual({ color: "midnight", inside: false });
    expect(mockupChoiceFor({ photos: [] })).toEqual({ color: "silver", inside: false });
  });

  it("restores preset tags onto server photos by asset id", () => {
    const server = [{ assetId: "a1", url: "https://x/1.png" }, { assetId: "a9", url: "https://x/9.jpg" }];
    expect(restorePresets(server, [lid])).toEqual([{ ...server[0], preset: "lid-midnight" }, server[1]]);
    expect(restorePresets(server, undefined)).toBe(server);
  });
});
