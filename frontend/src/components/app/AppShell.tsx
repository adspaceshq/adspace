import { AppSidebar, BottomTabs } from "./AppNav";
import { CompactFooter } from "./SiteFooter";
import { TopBar } from "./TopBar";

// Every page is exactly one screen tall: header pinned at the top, compact footer pinned at the bottom,
// and only the content between them scrolls (`#scroll`). Sticky elements inside pages stick within it.
// "public": browse, listings, profiles — no sidebar.
// "app": signed-in work areas — sidebar on desktop, bottom tabs on mobile.
export function AppShell({ children, variant = "public" }: { children: React.ReactNode; variant?: "public" | "app" }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <TopBar inSidebar={variant === "app"} />
      {variant === "public" ? (
        <div id="scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <main id="main" className="mx-auto w-full max-w-7xl px-4 py-8 pb-28 sm:px-6 lg:py-10">
            {children}
          </main>
        </div>
      ) : (
        // The sidebar is its own column outside the scroll area, so it never moves; only the content scrolls.
        <div className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 gap-8 px-4 sm:px-6">
          <AppSidebar />
          <div id="scroll" className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <main id="main" className="py-8 pb-24 lg:pb-10">
              {children}
            </main>
          </div>
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
