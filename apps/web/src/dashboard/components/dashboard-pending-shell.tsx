import { Spinner } from "@feeblo/ui/spinner";

export function DashboardPendingShell() {
  return (
    <div
      className="flex h-dvh min-h-svh w-full overflow-hidden bg-sidebar"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      {/* Sidebar placeholder */}
      <div className="relative hidden h-svh w-(--sidebar-width) flex-col p-2 md:flex">
        <div className="flex size-full" />
      </div>

      {/* Main area */}
      <main className="relative flex w-full flex-1 flex-col overflow-hidden rounded-2xl bg-background shadow-sm">
        {/* Content area with spinner */}
        <div className="flex flex-1 items-center justify-center overflow-hidden">
          <div className="flex flex-col items-center gap-3">
            <Spinner className="size-6" />
            <span className="text-muted-foreground text-sm">Loading...</span>
          </div>
        </div>
      </main>
    </div>
  );
}
