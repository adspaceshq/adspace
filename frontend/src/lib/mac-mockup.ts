import type { WizardPhoto, WizardState } from "@/lib/sell-draft";

// Built-in MacBook photos for laptop listings, hosted as transparent PNGs in our Cloudinary account.
// The backend only accepts photos the seller uploaded, so a chosen preset is re-uploaded as the seller's own asset.

export const MAC_COLORS = [
  { id: "silver", label: "silver", swatch: "#e3e4e6" },
  { id: "space-gray", label: "space grey", swatch: "#7d7e80" },
  { id: "space-black", label: "space black", swatch: "#2e2c2e" },
  { id: "midnight", label: "midnight", swatch: "#2e3642" },
  { id: "starlight", label: "starlight", swatch: "#f0e4d3" },
  { id: "sky-blue", label: "sky blue", swatch: "#a9c3d8" },
] as const;

export type MacColor = (typeof MAC_COLORS)[number]["id"];
export type MacPreset = `lid-${MacColor}` | "inside";

export interface MockupChoice {
  color: MacColor;
  inside: boolean;
}

export const DEFAULT_MOCKUP: MockupChoice = { color: "silver", inside: false };

const CLOUD_NAME = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || "jvd3gsf7";

// Original PNG (for re-uploading) or, with a width, an optimised display thumbnail.
export function presetUrl(preset: MacPreset, width?: number): string {
  const transform = width ? `f_auto,q_auto,w_${width}/` : "";
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}adspaces/static/mac/${preset}.png`;
}

// Lid first (the cover), keyboard deck second when chosen.
export function mockupPresets(choice: MockupChoice): MacPreset[] {
  return choice.inside ? [`lid-${choice.color}`, "inside"] : [`lid-${choice.color}`];
}

// True when the photos are exactly the uploads of this choice, so continuing needs no new upload.
export function mockupUploaded(photos: WizardPhoto[], choice: MockupChoice): boolean {
  const presets = mockupPresets(choice);
  return photos.length === presets.length && presets.every((preset, index) => photos[index].preset === preset);
}

const isColor = (value: string): value is MacColor => MAC_COLORS.some((color) => color.id === value);

// Recovers the choice behind a set of photos, or null when any of them is a custom upload.
export function detectMockup(photos: WizardPhoto[]): MockupChoice | null {
  const lid = photos[0]?.preset;
  if (!lid?.startsWith("lid-")) return null;
  const color = lid.slice(4);
  if (!isColor(color)) return null;
  if (photos.length === 1) return { color, inside: false };
  if (photos.length === 2 && photos[1].preset === "inside") return { color, inside: true };
  return null;
}

// Laptop listings start on the mockup when they have no photos or only mockup photos.
export function photoSourceFor(state: Pick<WizardState, "surface" | "photos" | "photoSource">): "mockup" | "upload" {
  if (state.surface !== "laptop") return "upload";
  if (state.photoSource) return state.photoSource;
  return state.photos.length === 0 || detectMockup(state.photos) ? "mockup" : "upload";
}

export function mockupChoiceFor(state: Pick<WizardState, "photos" | "mockup">): MockupChoice {
  return state.mockup ?? detectMockup(state.photos) ?? DEFAULT_MOCKUP;
}

// Copies preset tags from a locally saved draft onto server photos with the same asset ids.
export function restorePresets(photos: WizardPhoto[], saved: WizardPhoto[] | undefined): WizardPhoto[] {
  if (!saved) return photos;
  return photos.map((photo) => {
    const preset = saved.find((entry) => entry.assetId === photo.assetId)?.preset;
    return preset ? { ...photo, preset } : photo;
  });
}

// Fetches the preset PNG so it can go through the normal signed upload path.
export async function presetFile(preset: MacPreset, signal?: AbortSignal): Promise<File> {
  const response = await fetch(presetUrl(preset), { signal });
  if (!response.ok) throw new Error("couldn't load the mockup image");
  const blob = await response.blob();
  return new File([blob], `macbook-${preset}.png`, { type: "image/png" });
}
