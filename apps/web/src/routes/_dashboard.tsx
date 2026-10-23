import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import { ThemeProvider } from "@feeblo/ui/theme-provider";
import { AnchoredToastProvider, ToastProvider } from "@feeblo/ui/toast";
import { TooltipProvider } from "@feeblo/ui/tooltip";
import { AnalyticsProvider } from "@feeblo/web-shared/analytics-provider";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import { QueryClientProvider } from "@tanstack/react-query";
import { createFileRoute, Outlet } from "@tanstack/react-router";

import { getClientOnlyDocumentCacheControl } from "@/lib/document-cache-control";
import { getLocale, setLocale } from "@/paraglide/runtime.js";
import { DashboardPendingShell } from "~/components/dashboard-pending-shell";
import {
  PostHogIdentify,
  PostHogProvider,
  posthogAnalyticsClient,
} from "~/components/posthog-provider";
import { getContext } from "~/integrations/tanstack-query/root-provider";
import { dashboardAuthBeforeLoad } from "~/lib/auth-redirects";
import { startDashboardShellPreload } from "~/lib/preloads";

/**
 * The dashboard boundary: every route under `/_dashboard` is client-only and
 * guarded by the session-aware redirects in `~/lib/auth-redirects`.
 *
 * `ssr: false` preserves the `client:only` semantics the dashboard had under
 * Astro: the shell HTML ships without dashboard markup, `DashboardPendingShell`
 * paints as soon as the client entry hydrates, and the guard — which reads
 * `window.location` and the client-side auth atoms — runs on the client only.
 * The public board and the endpoint routes are outside this boundary and keep
 * their server rendering.
 *
 * The provider stack moved here from the deleted `dashboard/main.tsx`: it
 * renders on the client only, so the theme/toast/tooltip providers (which read
 * the DOM) and the auth/analytics providers (which read the browser session)
 * never run on the server. The public board has its own stack in the board's
 * layout route (`routes/s/route.tsx`), which does server-render.
 *
 * The document this route renders is visitor-independent (the session is
 * resolved in the browser), so it carries a shared cache policy — see
 * `@/lib/document-cache-control`. Its `beforeLoad` also starts the shell's
 * reads before the guard's session request resolves; see
 * `startDashboardShellPreload`.
 */
export const Route = createFileRoute("/_dashboard")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    // Not awaited: the shell's reads do not depend on the session, so they run
    // alongside the guard's session request rather than behind it. See
    // `startDashboardShellPreload`.
    startDashboardShellPreload(location.pathname);
    await dashboardAuthBeforeLoad({ location });
  },
  headers: () => {
    const cacheControl = getClientOnlyDocumentCacheControl();

    return cacheControl === undefined
      ? undefined
      : { "Cache-Control": cacheControl };
  },
  head: () => ({ meta: [{ title: "Dashboard" }] }),
  component: DashboardBoundary,
  // The boundary owns the full-page loader: it runs before the layout (and its
  // provider stack) exists, so per-route loading cannot cover it. The router's
  // default covers the routes inside the mounted shell instead.
  pendingComponent: DashboardPendingShell,
});

function DashboardBoundary() {
  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  // The same client-side singleton the router was created with; `_dashboard`
  // is client-only, so there is no per-request QueryClient to thread through.
  const { queryClient } = getContext();

  return (
    <AnalyticsProvider client={posthogAnalyticsClient}>
      <PostHogProvider>
        <AuthProvider>
          <PostHogIdentify />
          <ThemeProvider>
            <ToastProvider>
              <AnchoredToastProvider>
                <QueryClientProvider client={queryClient}>
                  <TooltipProvider>
                    <Outlet />
                  </TooltipProvider>
                </QueryClientProvider>
              </AnchoredToastProvider>
            </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </PostHogProvider>
    </AnalyticsProvider>
  );
}
