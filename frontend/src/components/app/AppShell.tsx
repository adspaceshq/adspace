import { AppSidebar, BottomTabs } from "./AppNav";
import { CompactFooter, SiteFooter } from "./SiteFooter";
import { TopBar } from "./TopBar";

// "public": browse, listings, profiles — full footer, no sidebar.
// "app": signed-in work areas — sidebar on desktop, bottom tabs on mobile, compact footer.
export function AppShell({ children, variant = "public" }: { children: React.ReactNode; variant?: "public" | "app" }) {
  if (variant === "public") {
    return (
      <div className="flex min-h-screen flex-col bg-canvas">
        <TopBar />
        <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:py-10">
          {children}
        </main>
        <SiteFooter />
      </div>
    );
  }
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <TopBar />
      <div className="mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 py-8 pb-24 sm:px-6 lg:pb-10">
        <AppSidebar />
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
      <CompactFooter />
      <BottomTabs />
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
