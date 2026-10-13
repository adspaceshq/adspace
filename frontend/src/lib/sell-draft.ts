import type { DraftInput, OwnedListing, PricingMode, SpotLayout, Surface } from "@/lib/api/types";
import type { MacPreset, MockupChoice } from "@/lib/mac-mockup";
import { toBaseUnits, toInputValue } from "@/lib/money";
import { normalizeView } from "@/lib/spot-views";

// Smallest auction bid step, in USDC base units (6 decimals); mirrors the program's MIN_BID_INCREMENT.
export const MIN_BID_INCREMENT = 10_000n;

export interface WizardSpot {
  key: string;
  label: string;
  price: string;
  layout: SpotLayout;
}

export interface WizardPhoto {
  assetId: string;
  url: string;
  // Set when the photo is an upload of a built-in mockup; kept only in the local draft.
  preset?: MacPreset;
}

export interface WizardState {
  surface: Surface;
  title: string;
  description: string;
  followers: string;
  event: string;
  location: string;
  photos: WizardPhoto[];
  spots: WizardSpot[];
  mode: PricingMode;
  minIncrement: string;
  doubleUp: boolean;
  deadline: string; // datetime-local value
  deliveryDays: string;
  // Laptop only: photos from the built-in MacBook mockup or the seller's own uploads.
  photoSource?: "mockup" | "upload";
  mockup?: MockupChoice;
}

export type WizardStep = "basics" | "spots" | "pricing" | "preview" | "submit";
export const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "basics", label: "basics" },
  { id: "spots", label: "spots" },
  { id: "pricing", label: "pricing & dates" },
  { id: "preview", label: "preview" },
  { id: "submit", label: "submit" },
];

const MAX_SPOTS = 60;
const DAY = 24 * 60 * 60 * 1000;

const key = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()));

// Starting layouts per surface; creators drag and resize from here.
const TEMPLATES: Record<Surface, { columns: number; rows: number; size: number }> = {
  laptop: { columns: 3, rows: 2, size: 15 },
  tshirt: { columns: 2, rows: 2, size: 18 },
  car: { columns: 2, rows: 2, size: 16 },
  suitcase: { columns: 2, rows: 1, size: 20 },
  bike: { columns: 2, rows: 1, size: 14 },
  digital: { columns: 3, rows: 1, size: 18 },
  other: { columns: 2, rows: 2, size: 16 },
};

export function templateSpots(surface: Surface, price = "10"): WizardSpot[] {
  const { columns, rows, size } = TEMPLATES[surface];
  const spots: WizardSpot[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = columns === 1 ? 50 : 25 + (column * 50) / (columns - 1);
      const y = rows === 1 ? 50 : 32 + (row * 36) / (rows - 1);
      spots.push({ key: key(), label: "", price, layout: { x: Math.round(x), y: Math.round(y), w: size } });
    }
  }
  return spots;
}

const localDateTime = (time: number) => {
  const date = new Date(time);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
};

export function emptyWizard(surface: Surface, now = Date.now()): WizardState {
  return {
    surface,
    title: "",
    description: "",
    followers: "",
    event: "",
    location: "",
    photos: [],
    spots: templateSpots(surface),
    mode: "fixed",
    minIncrement: "1",
    doubleUp: false,
    deadline: localDateTime(now + 7 * DAY),
    deliveryDays: "7",
  };
}

export type StepErrors = Partial<Record<string, string>>;

export function validateStep(step: WizardStep, state: WizardState, now = Date.now()): StepErrors {
  const errors: StepErrors = {};
  if (step === "basics" || step === "submit") {
    if (!state.title.trim()) errors.title = "give your listing a title";
    else if (state.title.trim().length > 80) errors.title = "keep the title under 80 characters";
    if (state.description.length > 2000) errors.description = "keep it under 2000 characters";
    if (state.followers && !/^\d{1,9}$/.test(state.followers.trim())) errors.followers = "whole number only";
    if (state.photos.length === 0) errors.photos = "add at least one photo of the surface";
  }
  if (step === "spots" || step === "submit") {
    if (state.spots.length === 0) errors.spots = "add at least one spot";
    if (state.spots.length > MAX_SPOTS) errors.spots = `at most ${MAX_SPOTS} spots`;
    state.spots.forEach((spot, index) => {
      try {
        if (BigInt(toBaseUnits(spot.price)) <= 0n) errors[`spot-${index}`] = "price must be above zero";
      } catch {
        errors[`spot-${index}`] = "enter a price like 25 or 12.50";
      }
    });
  }
  if (step === "pricing" || step === "submit") {
    const deadline = new Date(state.deadline).getTime();
    if (Number.isNaN(deadline)) errors.deadline = "pick when claims close";
    else if (deadline <= now + 60 * 60 * 1000) errors.deadline = "close claims at least an hour from now";
    const days = Number(state.deliveryDays);
    if (!Number.isInteger(days) || days < 1 || days > 60) errors.deliveryDays = "1 to 60 days";
    if (state.mode === "auction" && !state.doubleUp) {
      try {
        // Same floor as the program (MIN_BID_INCREMENT): smaller steps let bidders creep up by dust.
        if (BigInt(toBaseUnits(state.minIncrement)) < MIN_BID_INCREMENT) errors.minIncrement = "the minimum bid increment is 0.01 USDC";
      } catch {
        errors.minIncrement = "enter an amount like 1 or 0.50";
      }
    }
  }
  return errors;
}

export function toDraftInput(state: WizardState): DraftInput {
  const deadline = new Date(state.deadline);
  return {
    surface: state.surface,
    title: state.title.trim(),
    description: state.description.trim(),
    audience: {
      ...(state.followers.trim() ? { followers: Number(state.followers.trim()) } : {}),
      ...(state.event.trim() ? { event: state.event.trim() } : {}),
      ...(state.location.trim() ? { location: state.location.trim() } : {}),
    },
    mode: state.mode,
    deadline: deadline.toISOString(),
    deliveryDueAt: new Date(deadline.getTime() + Number(state.deliveryDays) * DAY).toISOString(),
    ...(state.mode === "auction" ? { doubleUp: state.doubleUp, ...(state.doubleUp ? {} : { minIncrement: state.minIncrement }) } : {}),
    // A spot whose photo was removed goes back to the cover rather than failing the save.
    spots: state.spots.map((spot) => ({ label: spot.label.trim() || undefined, price: spot.price.trim(), layout: normalizeView(spot.layout, state.photos.length) })),
    photoAssetIds: state.photos.map((photo) => photo.assetId),
  };
}

export function fromOwnedListing(listing: OwnedListing): WizardState {
  const deadline = new Date(listing.deadline).getTime();
  const deliveryDays = Math.max(1, Math.round((new Date(listing.deliveryDueAt).getTime() - deadline) / DAY));
  return {
    surface: listing.surface,
    title: listing.title,
    description: listing.description,
    followers: listing.audience.followers ? String(listing.audience.followers) : "",
    event: listing.audience.event ?? "",
    location: listing.audience.location ?? "",
    photos: (listing.photos ?? []).filter((photo) => photo.id).map((photo) => ({ assetId: photo.id!, url: photo.url })),
    spots: listing.spots.map((spot) => ({ key: spot.id, label: spot.label, price: toInputValue(spot.price), layout: spot.layout })),
    mode: listing.mode,
    minIncrement: BigInt(listing.minIncrement) > 0n ? toInputValue(listing.minIncrement) : "1",
    doubleUp: listing.doubleUp,
    deadline: localDateTime(deadline),
    deliveryDays: String(deliveryDays),
  };
}
