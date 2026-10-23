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

  const activeIndex = mobileNavItems.findIndex((item) =>
    pathname.startsWith(`/${organizationId}/${item.segment}`)
  );
  const hasActiveItem = activeIndex >= 0;

  return (
    <footer className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex items-center justify-center pb-4 md:hidden">
      <nav
        aria-label="Mobile navigation"
        className="bg-popover pointer-events-auto relative flex w-fit items-center justify-around gap-1 rounded-full border p-1 shadow-lg shadow-black/5 before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]"
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
        style={
          {
            "--active-item": String(Math.max(activeIndex, 0)),
          } as React.CSSProperties
        }
      >
        {/*
         * The pill is a sibling of the links and slides between them, so a tab
         * change reads as one control rather than two background swaps. The
         * items are equal width (`size-11`), so the offset is arithmetic: the
         * pill's own width plus the `gap-1` between items.
         */}
        <span
          aria-hidden="true"
          className="bg-sidebar-accent ease-in-out-strong pointer-events-none absolute inset-y-1 left-1 w-11 rounded-full transition-[transform,opacity] duration-200 motion-reduce:transition-none"
          data-slot="mobile-nav-indicator"
          style={{
            opacity: hasActiveItem ? 1 : 0,
            transform:
              "translateX(calc(var(--active-item) * (100% + 0.25rem)))",
          }}
        />
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
                "text-sidebar-foreground/80 aria-[current=page]:text-sidebar-accent-foreground size-11! rounded-full",
                "ease-out-strong transition-[scale,color] duration-150 active:scale-[0.97]",
                "motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:active:opacity-64"
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
          className="ease-out-strong size-11! rounded-full transition-[scale,color] duration-150 active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100 motion-reduce:active:opacity-64"
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
