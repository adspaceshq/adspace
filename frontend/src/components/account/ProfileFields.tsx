"use client";

import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { ACCEPT_ATTRIBUTE, uploadImage } from "@/lib/upload";
import { useHandleCheck } from "@/lib/use-handle-check";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { SellerAvatar } from "@/components/market/SellerAvatar";
import { userErrorMessage } from "@/lib/errors";

// Shared by onboarding and settings: photo, name and (for non-X accounts) handle.
export function useProfileForm(session: Session) {
  const { refresh } = useSession();
  const [name, setName] = useState(session.name ?? "");
  const [handle, setHandle] = useState(session.handle.startsWith("user-") ? "" : session.handle);
  const [avatar, setAvatar] = useState(session.avatar);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const check = useHandleCheck(handle, !session.hasX);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(undefined);
    try {
      setAvatar((await uploadImage("avatar", file)).url);
    } catch (cause) {
      setError(userErrorMessage(cause, "upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const dirty = name.trim() !== (session.name ?? "") || avatar !== session.avatar || (!session.hasX && check.clean !== session.handle);

  // Returns true when saved.
  const save = async (): Promise<boolean> => {
    if (!name.trim()) return (setError("add the name people will see"), false);
    if (!session.hasX && (check.error || !check.clean)) return (setError(check.error ?? "pick a handle"), false);
    setSaving(true);
    setError(undefined);
    try {
      await api.me.updateProfile({
        displayName: name.trim(),
        ...(avatar !== session.avatar ? { avatar: avatar ?? null } : {}),
        ...(!session.hasX && check.clean !== session.handle ? { handle: check.clean } : {}),
      });
      await refresh();
      return true;
    } catch (cause) {
      setError(userErrorMessage(cause, "couldn't save your profile. try again."));
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { session, name, setName, handle, setHandle, avatar, uploading, saving, error, check, pickAvatar, save, dirty };
}

export function ProfileFields({ form }: { form: ReturnType<typeof useProfileForm> }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const { session, check } = form;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <SellerAvatar seller={{ handle: check.clean || session.handle, displayName: form.name, avatarUrl: form.avatar ?? null }} size={72} />
        <input ref={fileInput} type="file" accept={ACCEPT_ATTRIBUTE} className="sr-only" onChange={(event) => void form.pickAvatar(event.target.files?.[0])} />
        <Button variant="secondary" size="sm" loading={form.uploading} onClick={() => fileInput.current?.click()}>
          <Camera className="size-4" aria-hidden /> {form.avatar ? "change photo" : "add photo"}
        </Button>
      </div>
      <Input label="name" value={form.name} onChange={(event) => form.setName(event.target.value)} maxLength={60} autoComplete="name" />
      {session.hasX ? (
        <Input label="handle" value={session.handle} disabled hint="linked to your X account" />
      ) : (
        <Input
          label="handle"
          value={form.handle}
          onChange={(event) => form.setHandle(event.target.value)}
          maxLength={31}
          autoCapitalize="none"
          spellCheck={false}
          error={form.check.error ?? undefined}
          hint={check.available && check.clean !== session.handle ? `adspaces.fun/${check.clean} is yours` : "your public page lives at adspaces.fun/handle"}
        />
      )}
      {form.error && (
        <p role="alert" className="text-small text-danger">
          {form.error}
        </p>
      )}
    </div>
  );
}
