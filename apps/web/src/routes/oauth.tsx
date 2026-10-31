import { AuthProvider } from "@feeblo/web-shared/auth-context";
import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * The OAuth authorization pages: workspace choice and consent.
 *
 * Under `/oauth` rather than the `_auth` layout on purpose: that boundary
 * redirects a signed-in visitor to the dashboard, and a signed-in member is
 * exactly who these pages are for. They render only in the browser: the
 * session lives in a cookie on the API origin, and the `oauth_query` they
 * complete is the redirect's signed search string, which only the browser
 * holds.
 */
export const Route = createFileRoute("/oauth")({
  ssr: false,
  head: () => ({ meta: [{ title: "Authorize application · Feeblo" }] }),
  component: OAuthLayout,
});

function OAuthLayout() {
  return (
    <AuthProvider hydrationSafe>
      <main className="bg-muted/30 flex min-h-dvh items-center justify-center p-6">
        <div className="bg-background w-full max-w-md rounded-xl border p-6 shadow-sm">
          <Outlet />
        </div>
      </main>
    </AuthProvider>
  );
}
