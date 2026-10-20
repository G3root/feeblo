import { Button, buttonVariants } from "@feeblo/ui/button";
import { useSidebar } from "@feeblo/ui/sidebar";
import { cn } from "@feeblo/ui/utils";
import {
  LayoutThreeColumnIcon,
  Megaphone03Icon,
  Menu01Icon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link, useRouterState } from "@tanstack/react-router";

import { useOrganizationId } from "~/hooks/use-organization-id";

const mobileNavItems = [
  {
    icon: MessageMultiple01Icon,
    label: "Feedback",
    segment: "feedback",
    to: "/$organizationId/feedback",
  },
  {
    icon: Megaphone03Icon,
    label: "Changelog",
    segment: "changelog",
    to: "/$organizationId/changelog",
  },
  {
    icon: LayoutThreeColumnIcon,
    label: "Roadmap",
    segment: "roadmap",
    to: "/$organizationId/roadmap",
  },
] as const;

export function MobileNav() {
  const organizationId = useOrganizationId();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { toggleSidebar } = useSidebar();

  return (
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-center justify-center pb-4 md:hidden">
      <nav
        aria-label="Mobile navigation"
        className="bg-popover pointer-events-auto relative flex w-fit items-center justify-around gap-1 rounded-full border p-1 shadow-lg shadow-black/5 backdrop-blur-sm before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
      >
        {mobileNavItems.map((item) => {
          const isActive = pathname.startsWith(
            `/${organizationId}/${item.segment}`
          );

          return (
            <Link
              aria-current={isActive ? "page" : undefined}
              aria-label={item.label}
              className={cn(
                buttonVariants({ size: "icon", variant: "ghost" }),
                "text-sidebar-foreground/80 aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground size-11! rounded-full"
              )}
              key={item.segment}
              params={{ organizationId }}
              to={item.to}
            >
              <HugeiconsIcon className="size-5" icon={item.icon} />
            </Link>
          );
        })}
        <Button
          aria-label="Open navigation"
          className="size-11! rounded-full"
          onClick={toggleSidebar}
          size="icon"
          variant="ghost"
        >
          <HugeiconsIcon className="size-5" icon={Menu01Icon} />
        </Button>
      </nav>
    </footer>
  );
}
