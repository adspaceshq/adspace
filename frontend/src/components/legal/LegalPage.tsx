import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app/AppShell";

/** Date the legal pages were last changed; bump with any wording change. */
export const LEGAL_UPDATED = "2026-10-16";
/** The terms version users accept (see lib/terms.ts, checked against the backend by a test). */
export { TERMS_VERSION } from "@/lib/terms";
export const SUPPORT_EMAIL = "support@adspaces.fun";

const legalLinks = [
  { href: "/terms", label: "terms" },
  { href: "/privacy", label: "privacy" },
  { href: "/fees", label: "fees" },
  { href: "/content-policy", label: "content policy" },
];

// Shared frame for the static legal pages: header, meta line, readable column, sibling links.
export function LegalPage({
  title,
  description,
  meta,
  children,
}: {
  title: string;
  description: string;
  meta?: string;
  children: React.ReactNode;
}) {
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl">
        <PageHeader title={title} description={description} />
        <p className="-mt-3 mb-8 text-small text-muted">{meta ?? `last updated ${LEGAL_UPDATED}`}</p>
        <article className="flex flex-col gap-8">{children}</article>
        <nav aria-label="legal" className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-6 text-small">
          {legalLinks.map((link) => (
            <Link key={link.href} href={link.href} className="text-muted hover:text-ink">
              {link.label}
            </Link>
          ))}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-muted hover:text-ink">
            {SUPPORT_EMAIL}
          </a>
        </nav>
      </div>
    </AppShell>
  );
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-3 text-body text-ink-soft">
      <h2 id={`${id}-title`} className="text-lead font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-subtle">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

export function LegalNotice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="rounded-card border border-line bg-warning-soft p-5 text-body text-ink-soft">
      <p className="mb-2 font-semibold text-warning">{title}</p>
      {children}
    </aside>
  );
}

export function TextLink({ href, children }: { href: string; children: React.ReactNode }) {
  const className = "font-medium text-accent hover:underline";
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <a href={href} className={className}>
      {children}
    </a>
  );
}
