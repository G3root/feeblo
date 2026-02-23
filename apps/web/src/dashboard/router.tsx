import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { AnchoredToastProvider, ToastProvider } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { getContext } from "./integrations/tanstack-query/root-provider";
import { RuntimeProvider } from "./lib/runtime/runtime-provider";
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
    defaultPendingComponent: () => (
      <div className="flex h-full min-h-screen w-full items-center justify-center">
        <div>Loading...</div>
      </div>
    ),
    Wrap({ children }: { children: React.ReactNode }) {
      return (
        <ToastProvider>
          <AnchoredToastProvider>
            <RuntimeProvider>
              <QueryClientProvider client={queryClient}>
                <TooltipProvider>{children}</TooltipProvider>
              </QueryClientProvider>
            </RuntimeProvider>
          </AnchoredToastProvider>
        </ToastProvider>
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
