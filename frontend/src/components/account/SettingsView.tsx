"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Bell, ExternalLink, LogOut, Mail, MailCheck, Settings, ShieldCheck, Store, UserRound, Zap } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api/v2";
import type { Session } from "@/lib/api/types";
import { useSession } from "@/lib/session";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Textarea } from "@/components/ui/Field";
import { ProfileFields, useProfileForm } from "@/components/account/ProfileFields";
import { NotificationPrefs } from "@/components/notifications/NotificationPrefs";
import { RoleEditor } from "@/components/onboarding/OnboardingFlow";

const SECTIONS = [
  { id: "profile", label: "profile", icon: UserRound },
  { id: "usage", label: "selling & sponsoring", icon: Store },
  { id: "email", label: "email", icon: Mail },
  { id: "notifications", label: "notifications", icon: Bell },
  { id: "security", label: "security", icon: ShieldCheck },
  { id: "account", label: "account", icon: Settings },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

const fromHash = (hash: string): SectionId => {
  const id = hash.replace(/^#/, "");
  return SECTIONS.some((section) => section.id === id) ? (id as SectionId) : "profile";
};

// One section at a time; the hash keeps deep links like /settings#notifications working.
function useSection(): [SectionId, (id: SectionId) => void] {
  const [section, setSection] = useState<SectionId>("profile");
  useEffect(() => {
    const sync = () => setSection(fromHash(window.location.hash));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const select = (id: SectionId) => {
    window.history.replaceState(null, "", `#${id}`);
    setSection(id);
  };
  return [section, select];
}

export function SettingsView() {
  const { session } = useSession();
  const [section, select] = useSection();
  if (!session) return null;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title font-semibold sm:text-display">settings</h1>
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="settings sections">
          <ul role="tablist" aria-orientation="vertical" className="flex gap-1 overflow-x-auto text-small lg:sticky lg:top-24 lg:flex-col lg:overflow-visible">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const active = id === section;
              return (
                <li key={id} className="shrink-0">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`panel-${id}`}
                    onClick={() => select(id)}
                    className={`flex w-full cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-control px-3 py-2 text-left transition-colors ${
                      active ? "bg-surface font-medium text-ink shadow-card" : "text-muted hover:bg-ink/5 hover:text-ink"
                    }`}
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div role="tabpanel" id={`panel-${section}`} className="flex max-w-2xl flex-col gap-6">
          {section === "profile" && <ProfileSection key={`${session.handle}:${session.name}:${session.avatar}`} session={session} />}
          {section === "usage" && (
            <Section id="usage" title="selling & sponsoring" description="your socials show on your listings; your brand prefills at checkout.">
              <RoleEditor key={JSON.stringify(session.onboarding)} session={session} submitLabel="save" />
            </Section>
          )}
          {section === "email" && <EmailSection session={session} />}
          {section === "notifications" && (
            <Section id="notifications" title="email notifications" description="everything always shows in the bell. choose what also reaches your inbox.">
              <NotificationPrefs />
            </Section>
          )}
          {section === "security" && <SecuritySection />}
          {section === "account" && <AccountSection session={session} />}
        </div>
      </div>
    </div>
  );
}

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="flex flex-col gap-4 p-5">
      <div>
        <h2 className="text-body font-semibold">{title}</h2>
        {description && <p className="text-small text-muted">{description}</p>}
      </div>
      {children}
    </Card>
  );
}

function ProfileSection({ session }: { session: Session }) {
  const form = useProfileForm(session);
  const profile = useQuery({ queryKey: ["profile", session.handle], queryFn: () => api.users.byHandle(session.handle) });
  const [bio, setBio] = useState<string>();
  const [saved, setSaved] = useState(false);
  const currentBio = bio ?? profile.data?.bio ?? "";
  const bioDirty = bio !== undefined && bio !== (profile.data?.bio ?? "");

  const save = async () => {
    setSaved(false);
    const ok = form.dirty ? await form.save() : true;
    if (ok && bioDirty) await api.me.updateProfile({ bio: currentBio });
    if (ok) {
      setSaved(true);
      await profile.refetch();
      setBio(undefined);
    }
  };

  return (
    <Section id="profile" title="profile" description="what sponsors and creators see on your public page.">
      <ProfileFields form={form} />
      <Textarea label="bio" value={currentBio} onChange={(event) => setBio(event.target.value)} rows={3} maxLength={280} hint="a line or two about you or your brand" />
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} loading={form.saving} disabled={form.uploading || (!form.dirty && !bioDirty)}>
          save profile
        </Button>
        {saved && !form.dirty && !bioDirty && <span className="text-small text-success">saved</span>}
      </div>
    </Section>
  );
}

function EmailSection({ session }: { session: Session }) {
  const { updateEmail, linkEmail, linkError } = useSession();
  return (
    <Section id="email" title="email" description="where we send outbid, proof-due, dispute and payout notices.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-body">
          {session.email ? (
            <>
              {session.email}
              {session.emailVerified && <BadgeCheck className="size-4 text-success" aria-label="verified" />}
            </>
          ) : (
            <span className="text-muted">no email yet</span>
          )}
        </p>
        <Button variant="secondary" size="sm" onClick={session.email ? updateEmail : linkEmail}>
          <MailCheck className="size-4" aria-hidden /> {session.email ? "change email" : "add email"}
        </Button>
      </div>
      <p className="text-small text-muted">a new address only replaces the old one after you enter the code we send to it.</p>
      {linkError && (
        <p role="alert" className="text-small text-danger">
          {linkError}
        </p>
      )}
    </Section>
  );
}

function SecuritySection() {
  const { wallet } = useSession();
  const [error, setError] = useState<string>();
  const run = async (action: () => Promise<void> | void) => {
    setError(undefined);
    try {
      await action();
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  return (
    <Section id="security" title="security">
      <Row
        icon={ShieldCheck}
        title="two-factor authentication"
        status={wallet.mfaEnabled ? "on" : "off"}
        description="required for every withdrawal."
        action={wallet.mfaEnabled ? "manage" : "set up"}
        onClick={() => void run(wallet.setupMfa)}
      />
      <Row
        icon={Zap}
        title="gasless transactions"
        status={wallet.delegated ? "on" : "off"}
        description="adspaces pays Solana fees and submits your claims, bids and payouts. withdrawals still need your two-factor code."
        action={wallet.delegated ? undefined : "turn on"}
        onClick={() => void run(wallet.enableGasless)}
      />
      {error && (
        <p role="alert" className="text-small text-danger">
          {error}
        </p>
      )}
    </Section>
  );
}

function Row({ icon: Icon, title, status, description, action, onClick }: { icon: typeof Zap; title: string; status: "on" | "off"; description: string; action?: string; onClick: () => void }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-body font-medium">
          {title} <span className={status === "on" ? "text-small text-success" : "text-small text-muted"}>· {status}</span>
        </p>
        <p className="text-small text-muted">{description}</p>
      </div>
      {action && (
        <Button variant="secondary" size="sm" onClick={onClick}>
          {action}
        </Button>
      )}
    </div>
  );
}

function AccountSection({ session }: { session: Session }) {
  const { signOut } = useSession();
  return (
    <Section id="account" title="account">
      <div className="flex flex-wrap gap-2">
        <Link href={`/${session.handle.replace(/^@/, "")}`} className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-small font-medium hover:border-line-strong">
          view public profile <ExternalLink className="size-3.5" aria-hidden />
        </Link>
        <Link href="/wallet" className="inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-2 text-small font-medium hover:border-line-strong">
          wallet
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          <LogOut className="size-4" aria-hidden /> sign out
        </Button>
      </div>
    </Section>
  );
}
