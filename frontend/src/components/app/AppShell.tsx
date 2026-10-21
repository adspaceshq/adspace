import { AppSidebar, BottomTabs, SignedInBottomTabs } from "./AppNav";
import { cx } from "@/lib/cx";
import { DevnetBanner } from "./DevnetBanner";
import { PausedBanner } from "./PausedBanner";
import { CompactFooter, SiteFooter } from "./SiteFooter";
import { TopBar } from "./TopBar";

// The window scrolls (one standard browser scrollbar). The header sticks to the top, the compact
// footer is fixed to the bottom on desktop, and the app sidebar sticks between them, so only the
// page content moves.
// "public": browse, listings, profiles — no sidebar.
// "app": signed-in work areas — sidebar on desktop, bottom tabs on mobile.
// Public pages on small screens get a menu in the top bar, bottom tabs when signed in, and the full
// footer (with the legal links). `mobileTabs={false}` for pages with their own bottom bar (listing).
// fill (app variant): on desktop the whole layout is exactly the window's height, so the window never
// scrolls; banners and the header take their space, the page gets the rest and scrolls its own panels.
// Phones scroll as usual.
export function AppShell({
  children,
  variant = "public",
  mobileTabs = true,
  fill = false,
}: {
  children: React.ReactNode;
  variant?: "public" | "app";
  mobileTabs?: boolean;
  fill?: boolean;
}) {
  return (
    <div className={cx("flex min-h-dvh flex-col bg-canvas", fill && "lg:h-dvh lg:overflow-hidden")}>
      <DevnetBanner />
      <PausedBanner />
      <TopBar inSidebar={variant === "app"} />
      {variant === "public" ? (
        <>
          <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:py-10 lg:pb-24">
            {children}
          </main>
          <div className="lg:hidden">
            <SiteFooter bottomInset />
          </div>
          {mobileTabs && <SignedInBottomTabs />}
        </>
      ) : (
        <div className={cx("mx-auto flex w-full max-w-7xl flex-1 gap-8 px-4 sm:px-6", fill && "lg:min-h-0")}>
          <AppSidebar />
          <main
            id="main"
            className={cx(
              "min-w-0 flex-1 py-8 pb-24",
              // The compact footer is fixed over the bottom 3rem; keep the page clear of it.
              fill ? "flex flex-col lg:min-h-0 lg:pb-16 lg:pt-6" : "lg:pb-24",
            )}
          >
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
