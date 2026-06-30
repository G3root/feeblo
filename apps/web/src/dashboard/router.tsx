import { ThemeProvider } from "@feeblo/ui/theme-provider";
import { AnchoredToastProvider, ToastProvider } from "@feeblo/ui/toast";
import { TooltipProvider } from "@feeblo/ui/tooltip";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { DashboardPendingShell } from "./components/dashboard-pending-shell";
import { getContext } from "./integrations/tanstack-query/root-provider";

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

export function createRouter() {
  const { queryClient } = getContext();
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    context: {
      queryClient,
    },
    defaultPendingComponent: DashboardPendingShell,
    defaultErrorComponent: () => (
      <div className="flex h-full min-h-screen w-full items-center justify-center">
        <div>Error</div>
      </div>
    ),
    Wrap({ children }: { children: React.ReactNode }) {
      return (
        <ThemeProvider>
          <ToastProvider>
            <AnchoredToastProvider>
              <QueryClientProvider client={queryClient}>
                <TooltipProvider>{children}</TooltipProvider>
              </QueryClientProvider>
            </AnchoredToastProvider>
          </ToastProvider>
        </ThemeProvider>
      );
    },
  });

  return router;
}

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createRouter>;
  }
}
