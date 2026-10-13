import { AppSidebar, BottomTabs } from "./AppNav";
import { CompactFooter } from "./SiteFooter";
import { TopBar } from "./TopBar";

// The window scrolls (one standard browser scrollbar). The header sticks to the top, the compact
// footer is fixed to the bottom on desktop, and the app sidebar sticks between them, so only the
// page content moves.
// "public": browse, listings, profiles — no sidebar.
// "app": signed-in work areas — sidebar on desktop, bottom tabs on mobile.
export function AppShell({ children, variant = "public" }: { children: React.ReactNode; variant?: "public" | "app" }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <TopBar inSidebar={variant === "app"} />
      {variant === "public" ? (
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 pb-28 sm:px-6 lg:py-10 lg:pb-24">
          {children}
        </main>
      ) : (
        <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 sm:px-6">
          <AppSidebar />
          <main id="main" className="min-w-0 flex-1 py-8 pb-24 lg:pb-24">
            {children}
          </main>
        </div>
      )}
      <CompactFooter />
      {variant === "app" && <BottomTabs />}
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
