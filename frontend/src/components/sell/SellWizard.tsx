"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Gavel, Tag } from "lucide-react";
import { api } from "@/lib/api/v2";
import type { Surface } from "@/lib/api/types";
import { mockupChoiceFor, mockupPresets, mockupUploaded, photoSourceFor, presetFile, restorePresets } from "@/lib/mac-mockup";
import { uploadImage } from "@/lib/upload";
import { emptyWizard, STEPS, toDraftInput, validateStep, type StepErrors, type WizardState, type WizardStep } from "@/lib/sell-draft";
import { SURFACE_LABELS } from "@/lib/listing-display";
import { viewLabel } from "@/lib/spot-views";
import { formatUsd, toBaseUnits } from "@/lib/money";
import { queryKeys } from "@/lib/query";
import { useSession } from "@/lib/session";
import { cx } from "@/lib/cx";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { SpotPhotos } from "@/components/ui/SpotPhotos";
import { Timeline } from "@/components/ui/Timeline";
import { MacMockupPicker } from "./MacMockupPicker";
import { PhotoUploader } from "./PhotoUploader";
import { SpotEditor } from "./SpotEditor";
import { userErrorMessage } from "@/lib/errors";

const storageKey = (listingId?: string, surface?: string) => `adspaces:sell:${listingId ?? `new:${surface}`}`;

const readSaved = (key: string): WizardState | undefined => {
  try {
    const saved = window.localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as WizardState) : undefined;
  } catch {
    return undefined; // ignore a corrupt or unavailable backup
  }
};

export function SellWizard({ surface, listingId: initialId, initial }: { surface: Surface; listingId?: string; initial?: WizardState }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const [listingId, setListingId] = useState(initialId);
  const [state, setState] = useState<WizardState>(() => {
    if (initial) {
      // The server doesn't know which photos are mockups; the local copy of this draft does.
      if (typeof window === "undefined" || !initialId) return initial;
      return { ...initial, photos: restorePresets(initial.photos, readSaved(storageKey(initialId))?.photos) };
    }
    return (typeof window !== "undefined" && readSaved(storageKey(undefined, surface))) || emptyWizard(surface);
  });
  const [step, setStep] = useState<WizardStep>("basics");
  const [errors, setErrors] = useState<StepErrors>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const [preparing, setPreparing] = useState<number | null>(null);
  const [mockupError, setMockupError] = useState<string>();
  const photoSource = photoSourceFor(state);
  const mockup = mockupChoiceFor(state);

  useEffect(() => {
    window.localStorage.setItem(storageKey(listingId, surface), JSON.stringify(state));
  }, [state, listingId, surface]);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) => setState((current) => ({ ...current, [key]: value }));
  const stepIndex = STEPS.findIndex((entry) => entry.id === step);

  // Persists to the server; the first save creates the draft.
  const save = async (current: WizardState = state) => {
    setSaving(true);
    setSaveError(undefined);
    try {
      const input = toDraftInput(current);
      if (listingId) {
        await api.listings.update(listingId, input);
      } else {
        const created = await api.listings.createDraft(input);
        window.localStorage.removeItem(storageKey(undefined, surface));
        setListingId(created.listing.id);
        window.history.replaceState(null, "", `/sell/drafts/${created.listing.id}`);
      }
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard });
      return true;
    } catch (cause) {
      setSaveError(userErrorMessage(cause, "couldn't save; try again"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Uploads the chosen mockup as the seller's own photos (the API only takes their uploads).
  // Photos already uploaded from the same preset are reused, so nothing is uploaded twice.
  const applyMockup = async (): Promise<WizardState | null> => {
    if (mockupUploaded(state.photos, mockup)) return state;
    setMockupError(undefined);
    setPreparing(0);
    try {
      const presets = mockupPresets(mockup);
      const progress = presets.map(() => 0);
      const report = () => setPreparing(progress.reduce((sum, value) => sum + value, 0) / presets.length);
      const photos = await Promise.all(
        presets.map(async (preset, index) => {
          const existing = state.photos.find((photo) => photo.preset === preset);
          if (existing) {
            progress[index] = 1;
            return existing;
          }
          const file = await presetFile(preset);
          const asset = await uploadImage("listing_photo", file, {
            onProgress: (fraction) => {
              progress[index] = fraction;
              report();
            },
          });
          return { assetId: asset.id, url: asset.url, preset };
        }),
      );
      setState((current) => ({ ...current, photos, photoSource: "mockup", mockup }));
      return { ...state, photos, photoSource: "mockup", mockup };
    } catch (cause) {
      setMockupError(`couldn't add the mockup: ${userErrorMessage(cause, "upload failed")}`);
      return null;
    } finally {
      setPreparing(null);
    }
  };

  const go = async (target: WizardStep) => {
    const targetIndex = STEPS.findIndex((entry) => entry.id === target);
    if (targetIndex > stepIndex) {
      let current = state;
      if (step === "basics" && photoSource === "mockup") {
        const next = await applyMockup();
        if (!next) return;
        current = next;
      }
      for (const entry of STEPS.slice(0, targetIndex)) {
        const found = validateStep(entry.id, current);
        if (Object.keys(found).length > 0) {
          setErrors(found);
          setStep(entry.id);
          return;
        }
      }
      if (!(await save(current))) {
        // The save sends the whole draft, so a later step can be what the server refused (e.g. a saved
        // draft from before a rule changed). Show that step with the error on its field.
        const later = STEPS.slice(targetIndex).find((entry) => Object.keys(validateStep(entry.id, current)).length > 0);
        if (later) {
          setSaveError(undefined);
          setErrors(validateStep(later.id, current));
          setStep(later.id);
        }
        return;
      }
    }
    setErrors({});
    setStep(target);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    const found = validateStep("submit", state);
    if (Object.keys(found).length > 0) return setErrors(found);
    if (!(await save())) return;
    setSaving(true);
    try {
      await api.listings.submit(listingId!);
      window.localStorage.removeItem(storageKey(listingId, surface));
      await queryClient.invalidateQueries({ queryKey: queryKeys.creatorDashboard });
      router.push("/dashboard/creator?submitted=1");
    } catch (cause) {
      setSaveError(userErrorMessage(cause, "couldn't submit; try again"));
      setSaving(false);
    }
  };

  const cover = state.photos[0]?.url;
  // Spots can go on any photo; mockup photos are named after the part of the laptop they show.
  const views = state.photos.map((photo, index) => ({ url: photo.url, label: viewLabel(index, photo.preset) }));

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-title font-semibold sm:text-display">list your {SURFACE_LABELS[state.surface]}</h1>
          <p className="text-small text-muted" aria-live="polite">
            {preparing !== null ? "adding mockup…" : saving ? "saving…" : saved ? "draft saved" : listingId ? "draft" : "not saved yet"}
          </p>
        </div>
        <ol className="no-scrollbar flex gap-1 overflow-x-auto" aria-label="steps">
          {STEPS.map((entry, index) => (
            <li key={entry.id} className="flex-1">
              <button
                type="button"
                onClick={() => void go(entry.id)}
                aria-current={entry.id === step ? "step" : undefined}
                className="flex w-full min-w-24 cursor-pointer flex-col gap-1.5 text-left"
              >
                <span className={cx("h-1 rounded-full", index <= stepIndex ? "bg-ink" : "bg-line")} />
                <span className={cx("text-small", entry.id === step ? "font-semibold text-ink" : "text-muted")}>
                  {index + 1}. {entry.label}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>

      {step === "basics" && (
        <section className="flex max-w-3xl flex-col gap-5">
          <Input label="title" placeholder="e.g. MacBook lid at Token2049" value={state.title} maxLength={80} onChange={(event) => set("title", event.target.value)} error={errors.title} />
          <Textarea
            label="description"
            hint="where it'll be seen, for how long, and by whom"
            value={state.description}
            maxLength={2000}
            rows={5}
            onChange={(event) => set("description", event.target.value)}
            error={errors.description}
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="followers (optional)" inputMode="numeric" placeholder="12400" value={state.followers} onChange={(event) => set("followers", event.target.value)} error={errors.followers} />
            <Input label="event (optional)" placeholder="Token2049" value={state.event} maxLength={80} onChange={(event) => set("event", event.target.value)} />
            <Input label="city (optional)" placeholder="Singapore" value={state.location} maxLength={80} onChange={(event) => set("location", event.target.value)} />
          </div>
          <div className="flex flex-col gap-2">
            <p className="text-small font-medium">photos</p>
            <p className="text-small text-muted">the first photo is the cover. you can place spots on any photo.</p>
            {state.surface === "laptop" && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="photo source">
                {[
                  { source: "mockup" as const, title: "use a MacBook mockup", text: "pick a colour, no photo needed" },
                  { source: "upload" as const, title: "upload your own photo", text: "show your actual laptop" },
                ].map((option) => (
                  <button
                    key={option.source}
                    type="button"
                    role="radio"
                    aria-checked={photoSource === option.source}
                    disabled={preparing !== null}
                    onClick={() => {
                      setMockupError(undefined);
                      setState((current) => ({ ...current, photoSource: option.source }));
                    }}
                    className={cx(
                      "flex cursor-pointer flex-col gap-0.5 rounded-card border p-3 text-left transition-colors disabled:cursor-not-allowed",
                      photoSource === option.source ? "border-ink bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong",
                    )}
                  >
                    <span className="text-body font-semibold">{option.title}</span>
                    <span className="text-small text-muted">{option.text}</span>
                  </button>
                ))}
              </div>
            )}
            {photoSource === "mockup" ? (
              <MacMockupPicker
                choice={mockup}
                onChange={(choice) => {
                  setMockupError(undefined);
                  setState((current) => ({ ...current, mockup: choice }));
                }}
                replacing={state.photos.filter((photo) => !photo.preset).length}
                error={mockupError}
                onRetry={() => void go(STEPS[stepIndex + 1].id)}
                busy={preparing !== null}
              />
            ) : (
              <PhotoUploader photos={state.photos} onChange={(update) => setState((current) => ({ ...current, photos: update(current.photos) }))} error={errors.photos} />
            )}
          </div>
        </section>
      )}

      {step === "spots" && cover && (
        <SpotEditor photos={views} spots={state.spots} errors={errors} onChange={(update) => setState((current) => ({ ...current, spots: update(current.spots) }))} />
      )}

      {step === "pricing" && (
        <section className="flex max-w-3xl flex-col gap-6">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="pricing">
            {[
              { mode: "fixed" as const, icon: Tag, title: "fixed price", text: "sponsors claim a spot at your price. first come, first served." },
              { mode: "auction" as const, icon: Gavel, title: "auction", text: "sponsors bid; the highest bid when bidding closes wins. you set the starting price." },
            ].map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={state.mode === option.mode}
                onClick={() => set("mode", option.mode)}
                className={cx(
                  "flex cursor-pointer flex-col gap-2 rounded-card border p-4 text-left transition-colors",
                  state.mode === option.mode ? "border-ink bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong",
                )}
              >
                <option.icon className="size-5" aria-hidden />
                <span className="text-body font-semibold">{option.title}</span>
                <span className="text-small text-muted">{option.text}</span>
              </button>
            ))}
          </div>
          {state.mode === "auction" && (
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
              <label className="flex cursor-pointer items-center gap-2 text-body">
                <input type="checkbox" checked={state.doubleUp} onChange={(event) => set("doubleUp", event.target.checked)} className="size-4 accent-ink" />
                double-up bidding: each new bid must be at least twice the current one
              </label>
              {!state.doubleUp && (
                <Input label="minimum bid increment (USDC)" inputMode="decimal" value={state.minIncrement} onChange={(event) => set("minIncrement", event.target.value)} error={errors.minIncrement} />
              )}
              <p className="text-small text-muted">spot prices from the previous step are the starting bids. a bid in the final 5 minutes extends bidding by 5 minutes.</p>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={state.mode === "auction" ? "bidding closes" : "claims close"}
              type="datetime-local"
              value={state.deadline}
              onChange={(event) => set("deadline", event.target.value)}
              error={errors.deadline}
            />
            <Input
              label="days to deliver after that"
              inputMode="numeric"
              value={state.deliveryDays}
              onChange={(event) => set("deliveryDays", event.target.value)}
              error={errors.deliveryDays}
              hint="time to place the brands and post proof"
            />
          </div>
          {!errors.deadline && !Number.isNaN(new Date(state.deadline).getTime()) && Number(state.deliveryDays) > 0 && (
            <Timeline
              steps={[
                { label: `${state.mode === "auction" ? "bidding" : "claims"} close`, detail: new Date(state.deadline).toLocaleString(), state: "current" },
                {
                  label: "you deliver and post proof",
                  detail: `by ${new Date(new Date(state.deadline).getTime() + Number(state.deliveryDays) * 86_400_000).toLocaleDateString()}`,
                  state: "upcoming",
                },
                { label: "sponsors review, then you're paid", detail: "48 hours by default, set at approval", state: "upcoming" },
              ]}
            />
          )}
        </section>
      )}

      {step === "preview" && (
        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {cover && (
            <SpotPhotos
              photos={views}
              alt={state.title}
              spots={state.spots.map((spot, index) => {
                let price: string | undefined;
                try {
                  price = toBaseUnits(spot.price);
                } catch {
                  price = undefined;
                }
                return { id: spot.key, index, layout: spot.layout, state: "open" as const, price, label: spot.label };
              })}
            />
          )}
          <div className="flex flex-col gap-3 rounded-panel border border-line bg-surface p-5 shadow-card">
            <p className="text-caption font-medium uppercase tracking-wide text-subtle">preview</p>
            <h2 className="text-title font-semibold leading-tight">{state.title || "untitled"}</h2>
            <p className="text-small text-muted">@{session?.handle.replace(/^@/, "") ?? "you"}</p>
            {state.description && <p className="whitespace-pre-line text-body text-muted">{state.description}</p>}
            <p className="text-body">
              {state.spots.length} spot{state.spots.length === 1 ? "" : "s"} · {state.mode === "auction" ? "auction" : "fixed price"}
            </p>
          </div>
        </section>
      )}

      {step === "submit" && (
        <section className="flex max-w-2xl flex-col gap-5">
          <dl className="grid gap-3 rounded-panel border border-line bg-surface p-5 text-body shadow-card sm:grid-cols-2">
            <div>
              <dt className="text-small text-muted">listing</dt>
              <dd className="font-medium">{state.title}</dd>
            </div>
            <div>
              <dt className="text-small text-muted">spots</dt>
              <dd className="font-medium">
                {state.spots.length} · {state.mode === "auction" ? "auction" : "fixed price"}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted">total at listed prices</dt>
              <dd className="font-medium">
                {(() => {
                  try {
                    return formatUsd(state.spots.reduce((sum, spot) => sum + BigInt(toBaseUnits(spot.price)), 0n));
                  } catch {
                    return "—";
                  }
                })()}
              </dd>
            </div>
            <div>
              <dt className="text-small text-muted">photos</dt>
              <dd className="font-medium">{state.photos.length}</dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 rounded-card bg-canvas p-4 text-small text-muted">
            <p className="font-medium text-ink">what happens next</p>
            <p className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> the adspaces team reviews it, usually within a day, and sets the platform fee.
            </p>
            <p className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> you see the exact fee and dates, then accept and publish.
            </p>
            <p className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden /> sponsors pay into escrow; you&apos;re paid once delivery is proven.
            </p>
          </div>
        </section>
      )}

      {saveError && (
        <p role="alert" className="text-small text-danger">
          {saveError}
        </p>
      )}

      <div className="sticky bottom-20 z-20 flex items-center justify-between gap-3 rounded-panel border border-line bg-surface/95 p-3 shadow-pop backdrop-blur-md lg:bottom-4">
        <Button variant="ghost" onClick={() => void go(STEPS[stepIndex - 1].id)} disabled={stepIndex === 0 || saving}>
          back
        </Button>
        {step === "submit" ? (
          <Button onClick={() => void submit()} loading={saving}>
            submit for review
          </Button>
        ) : (
          <Button onClick={() => void go(STEPS[stepIndex + 1].id)} loading={saving || preparing !== null}>
            {preparing !== null ? `adding mockup ${Math.round(preparing * 100)}%` : "continue"}
          </Button>
        )}
      </div>
    </div>
  );
}
