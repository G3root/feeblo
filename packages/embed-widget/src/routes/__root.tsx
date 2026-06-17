import {
  BookOpen01Icon,
  Cancel01Icon,
  ChatFeedback01Icon,
  MapPinIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  createRootRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import { useState } from "react";
import { cn } from "../lib/utils";

export const rootRoute = createRootRoute({
  component: RootComponent,
});

const tabs = [
  {
    to: "/feedback",
    label: "Feedback",
    icon: ChatFeedback01Icon,
  },
  {
    to: "/roadmap",
    label: "Roadmap",
    icon: MapPinIcon,
  },
  {
    to: "/updates",
    label: "Updates",
    icon: BookOpen01Icon,
  },
];

const subtitles: Record<string, string> = {
  "/feedback": "Share your ideas and feedback",
  "/roadmap": "See what we're planning",
  "/updates": "Latest updates and improvements",
};

function RootComponent() {
  const [isOpen, setIsOpen] = useState(true);
  const state = useRouterState();
  const activePath = state.location.pathname;

  const handleClose = () => {
    setIsOpen(false);
    if (window.parent !== window) {
      window.parent.postMessage({ event: "CLOSE" }, "*");
    }
  };

  if (!isOpen) {
    return null;
  }

  const activeTab = tabs.find((tab) => tab.to === activePath);
  const title = activeTab?.label ?? "What's New";
  const subtitle = subtitles[activePath] ?? "";

  return (
    <div
      className="fixed inset-0 z-[999999999]"
      data-feeblo-widget-container
      style={{ pointerEvents: "none" }}
    >
      {/* Backdrop */}
      <button
        aria-label="Close"
        className="fade-in fixed inset-0 z-40 animate-in bg-black/30 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none"
        onClick={handleClose}
        style={{ pointerEvents: "auto" }}
        type="button"
      />

      {/* Modal */}
      <div
        className="fade-in slide-in-from-right animation-duration-300 fixed inset-0 z-50 animate-in sm:top-4 sm:right-4 sm:bottom-4 sm:left-auto sm:w-[370px]"
        id="feeblo-modal"
        style={{ pointerEvents: "auto" }}
      >
        <div className="relative flex h-full flex-col overflow-hidden border border-border bg-popover text-popover-foreground shadow-2xl ring-1 ring-foreground/5 sm:rounded-4xl dark:ring-foreground/10">
          {/* Header */}
          <div className="relative border-border/60 border-b bg-muted/40">
            <button
              aria-label="Close"
              className="absolute top-6 left-6 z-20 flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-secondary-foreground transition-colors hover:bg-secondary/80 focus-visible:ring-3 focus-visible:ring-ring/30"
              onClick={handleClose}
              type="button"
            >
              <HugeiconsIcon className="size-4" icon={Cancel01Icon} />
            </button>
            <div className="px-6" style={{ paddingTop: 72, paddingBottom: 32 }}>
              <h1 className="font-semibold text-2xl text-foreground tracking-tight">
                {title}
              </h1>
              {subtitle ? (
                <p className="mt-1 text-muted-foreground text-sm">{subtitle}</p>
              ) : null}
            </div>
          </div>

          {/* Main content */}
          <main className="hide-scrollbar flex-1 overflow-y-auto pb-0">
            <Outlet />
          </main>

          {/* Footer nav */}
          <div className="mt-auto border-border/60 border-t">
            <nav className="flex items-center justify-around">
              {tabs.map((tab) => {
                const isActive = activePath === tab.to;
                return (
                  <Link
                    aria-label={tab.label}
                    className={cn(
                      "group relative flex flex-1 flex-col items-center justify-center py-3 transition-colors",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    draggable={false}
                    key={tab.to}
                    to={tab.to}
                  >
                    {isActive ? (
                      <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" />
                    ) : null}
                    <HugeiconsIcon
                      className={cn(
                        "mb-1 size-5 transition-colors",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                      icon={tab.icon}
                    />
                    <span
                      className={cn(
                        "font-medium text-[10px] transition-colors",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {tab.label}
                    </span>
                  </Link>
                );
              })}
            </nav>
            <div className="border-border/60 border-t bg-muted/40 sm:rounded-b-3xl">
              <div className="flex items-center justify-center px-4 py-3">
                <a
                  className="flex items-center gap-1 font-medium text-[11px] text-muted-foreground leading-none tracking-[0.02em] transition-colors hover:text-foreground"
                  draggable={false}
                  href="https://feeblo.com?utm_source=powered_by&utm_medium=referral&utm_campaign=widget"
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  <span>Powered by</span>
                  <span className="animate-gradient bg-[length:200%_auto] bg-gradient-to-r from-primary/60 via-primary to-primary/60 bg-clip-text font-semibold text-transparent">
                    Feeblo
                  </span>
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
