import Link from "next/link";
import Header from "@/components/Header";

// Shell for every rebuilt page. The landing page keeps its own layout and curtain footer.
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
        {children}
      </main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-small text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>© {new Date().getFullYear()} adspaces</span>
          <nav className="flex gap-4">
            <Link href="/browse" className="hover:text-ink">browse</Link>
            <a href="mailto:support@adspaces.fun" className="hover:text-ink">support</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-title font-semibold sm:text-display">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-body text-muted">{description}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  );
}
