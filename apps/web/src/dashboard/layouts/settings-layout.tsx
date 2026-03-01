import { Link } from "@tanstack/react-router";
import { SettingsSidebar } from "~/components/common/settings-sidebar";
import { buttonVariants } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "~/components/ui/sidebar";
import { useOrganizationId } from "~/hooks/use-organization-id";

export function SettingsLayout({ children }: { children: React.ReactNode }) {
  const organizationId = useOrganizationId();

  return (
    <SidebarProvider
      className="h-dvh overflow-hidden"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <SettingsSidebar variant="inset" />
      <SidebarInset className="h-full min-h-0 overflow-hidden">
        <header className="flex h-(--header-height) shrink-0 items-center border-b px-4 md:hidden">
          <div className="flex w-full items-center justify-between gap-2">
            <SidebarTrigger className="-ml-1" />
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              params={{ organizationId }}
              to="/$organizationId"
            >
              Back to Dashboard
            </Link>
          </div>
        </header>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          {children}
        </ScrollArea>
      </SidebarInset>
    </SidebarProvider>
  );
}
