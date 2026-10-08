"use client";

import { useQuery } from "@tanstack/react-query";
import { Camera, Check, Lock, MailCheck, Megaphone, Store, Users } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { BRAND_CATEGORIES, buildOnboarding, handleError, landingPath, SOCIAL_PLATFORMS, sells, sponsors, type Role, type RoleErrors, type RoleForm } from "@/lib/onboarding";
import { useSession } from "@/lib/session";
import { ACCEPT_ATTRIBUTE, uploadImage } from "@/lib/upload";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { SellerAvatar } from "@/components/market/SellerAvatar";

type Step = "email" | "profile" | "role";
const STEPS: Array<{ id: Step; label: string }> = [
  { id: "email", label: "email" },
  { id: "profile", label: "profile" },
  { id: "role", label: "how you'll use it" },
];

export function OnboardingFlow() {
  const { ready, session, signIn } = useSession();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [profileDone, setProfileDone] = useState(false);

  const finished = Boolean(session?.emailVerified && session.onboarding);
  useEffect(() => {
    if (finished && session?.onboarding) router.replace(landingPath(next, session.onboarding.accountType));
  }, [finished, next, router, session?.onboarding]);

  if (!ready || finished) return <Skeleton className="h-96 w-full" />;
  if (!session) {
    return (
      <EmptyState
        icon={Lock}
        title="create your adspaces account"
        description="use x, google or email. a wallet is created for you automatically."
        action={<Button onClick={signIn}>sign in</Button>}
      />
    );
  }

  const step: Step = !session.emailVerified ? "email" : profileDone ? "role" : "profile";
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8">
      <ol className="flex items-center gap-2 text-small" aria-label="setup progress">
        {STEPS.map((item, index) => {
          const current = STEPS.findIndex((entry) => entry.id === step);
          const done = index < current;
          return (
            <li key={item.id} className="flex flex-1 flex-col gap-1.5" aria-current={item.id === step ? "step" : undefined}>
              <span className={`h-1 rounded-full ${done || index === current ? "bg-ink" : "bg-line"}`} />
              <span className={index === current ? "font-medium text-ink" : "text-muted"}>{item.label}</span>
            </li>
          );
        })}
      </ol>
      {step === "email" && <EmailStep />}
      {step === "profile" && <ProfileStep session={session} onDone={() => setProfileDone(true)} />}
      {step === "role" && <RoleStep session={session} onBack={() => setProfileDone(false)} />}
    </div>
  );
}

function EmailStep() {
  const { linkEmail, linkError } = useSession();
  return (
    <section className="flex flex-col gap-4">
      <MailCheck className="size-8 text-accent" aria-hidden />
      <h1 className="text-title font-semibold">verify your email</h1>
      <p className="text-body text-muted">
        it&apos;s how we reach you when money moves: when you&apos;re outbid, when proof is due, when a dispute opens and when you get paid. we send a one-time code; no password.
      </p>
      {linkError && (
        <p role="alert" className="text-small text-danger">
          {linkError}
        </p>
      )}
      <Button onClick={linkEmail} className="self-start">
        send me a code
      </Button>
    </section>
  );
}

function ProfileStep({ session, onDone }: { session: Session; onDone: () => void }) {
  const { refresh } = useSession();
  const [name, setName] = useState(session.name ?? "");
  const [handle, setHandle] = useState(session.handle.startsWith("user-") ? "" : session.handle);
  const [avatar, setAvatar] = useState(session.avatar);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const fileInput = useRef<HTMLInputElement>(null);

  const clean = handle.trim().replace(/^@+/, "");
  const localHandleError = session.hasX ? null : handleError(clean);
  const [debounced, setDebounced] = useState(clean);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(clean), 350);
    return () => clearTimeout(timer);
  }, [clean]);
  const availability = useQuery({
    queryKey: ["handle-available", debounced],
    queryFn: () => api.handles.available(debounced),
    enabled: !session.hasX && !handleError(debounced),
    staleTime: 30_000,
  });
  const taken = availability.data && !availability.data.available ? (availability.data.reason ?? "that handle is taken") : null;
  const handleMessage = clean ? (localHandleError ?? taken) : null;

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      setAvatar((await uploadImage("avatar", file)).url);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return setError("add the name people will see");
    if (!session.hasX && (localHandleError || taken || !clean)) return setError(localHandleError ?? taken ?? "pick a handle");
    setSaving(true);
    setError(undefined);
    try {
      await api.me.updateProfile({
        displayName: name.trim(),
        ...(avatar !== session.avatar ? { avatar: avatar ?? null } : {}),
        ...(!session.hasX && clean !== session.handle ? { handle: clean } : {}),
      });
      await refresh();
      onDone();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-title font-semibold">your profile</h1>
      <div className="flex items-center gap-4">
        <SellerAvatar seller={{ handle: clean || session.handle, displayName: name, avatarUrl: avatar ?? null }} size={72} />
        <input ref={fileInput} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(event) => void pickAvatar(event.target.files?.[0])} />
        <Button variant="secondary" size="sm" loading={uploading} onClick={() => fileInput.current?.click()}>
          <Camera className="size-4" aria-hidden /> {avatar ? "change photo" : "add photo"}
        </Button>
      </div>
      <Input label="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} autoComplete="name" />
      {session.hasX ? (
        <Input label="handle" value={session.handle} disabled hint="linked to your X account" />
      ) : (
        <Input
          label="handle"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          maxLength={31}
          autoCapitalize="none"
          spellCheck={false}
          error={handleMessage ?? undefined}
          hint={clean && availability.data?.available && debounced === clean ? `adspaces.fun/${clean} is yours` : "your public page lives at adspaces.fun/handle"}
        />
      )}
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <Button onClick={() => void save()} loading={saving} disabled={uploading} className="self-start">
        continue
      </Button>
    </section>
  );
}

const ROLES: Array<{ id: Role; title: string; description: string; icon: typeof Store }> = [
  { id: "creator", title: "I sell ad space", description: "list your laptop, car, bag or anything people see. get paid in USDC.", icon: Store },
  { id: "sponsor", title: "I sponsor", description: "put your brand on real things in the real world. pay only on delivery.", icon: Megaphone },
  { id: "both", title: "both", description: "sell space and sponsor others from one account.", icon: Users },
];

function RoleStep({ session, onBack }: { session: Session; onBack: () => void }) {
  const { refresh } = useSession();
  const [form, setForm] = useState<RoleForm>({ role: null, socials: session.hasX ? { x: session.handle } : {}, brandName: "", category: "", website: "" });
  const [errors, setErrors] = useState<RoleErrors>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const set = (patch: Partial<RoleForm>) => setForm((current) => ({ ...current, ...patch }));

  const submit = async () => {
    const built = buildOnboarding(form);
    setErrors(built.errors);
    if (!built.payload) return;
    setSaving(true);
    setError(undefined);
    try {
      await api.me.saveOnboarding(built.payload);
      await refresh();
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  };

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-title font-semibold">how will you use adspaces?</h1>
      <div role="radiogroup" aria-label="account type" className="grid gap-2 sm:grid-cols-3">
        {ROLES.map(({ id, title, description, icon: Icon }) => {
          const selected = form.role === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => set({ role: id })}
              className={`relative flex flex-col gap-2 rounded-card border p-4 text-left transition-colors ${selected ? "border-ink bg-surface shadow-card" : "border-line bg-surface hover:border-line-strong"}`}
            >
              {selected && <Check className="absolute right-3 top-3 size-4" aria-hidden />}
              <Icon className="size-5 text-accent" aria-hidden />
              <span className="text-body font-semibold">{title}</span>
              <span className="text-small text-muted">{description}</span>
            </button>
          );
        })}
      </div>
      {errors.role && <p className="text-small text-danger">{errors.role}</p>}

      {sells(form.role) && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-semibold">where people see you</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {SOCIAL_PLATFORMS.map((platform) => (
              <Input
                key={platform}
                label={platform === "x" ? "X" : platform}
                placeholder="@handle"
                value={form.socials[platform] ?? ""}
                onChange={(event) => set({ socials: { ...form.socials, [platform]: event.target.value } })}
                maxLength={100}
              />
            ))}
          </div>
          {errors.socials && <p className="text-small text-danger">{errors.socials}</p>}
        </fieldset>
      )}

      {sponsors(form.role) && (
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-body font-semibold">your brand</legend>
          <p className="-mt-1 text-small text-muted">we prefill this at checkout; you can change it per spot.</p>
          <Input label="brand name" value={form.brandName} onChange={(event) => set({ brandName: event.target.value })} maxLength={80} error={errors.brandName} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor="brand-category" className="text-small font-medium">
              category
            </label>
            <select
              id="brand-category"
              value={form.category}
              onChange={(event) => set({ category: event.target.value })}
              className="h-10 rounded-control border border-line bg-surface px-3 text-body"
            >
              <option value="">choose one</option>
              {BRAND_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            {errors.category && <p className="text-small text-danger">{errors.category}</p>}
          </div>
          <Input label="website (optional)" placeholder="https://" inputMode="url" value={form.website} onChange={(event) => set({ website: event.target.value })} error={errors.website} />
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onBack} disabled={saving}>
          back
        </Button>
        <Button onClick={() => void submit()} loading={saving}>
          finish
        </Button>
      </div>
    </section>
  );
}
