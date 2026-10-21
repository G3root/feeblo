import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import { AnchoredToastProvider, ToastProvider } from "@feeblo/ui/toast";
import { AuthProvider, useResolvedAuth } from "@feeblo/web-shared/auth-context";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useRouterState,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getLocale, setLocale } from "@/paraglide/runtime.js";
import {
  authPageBeforeLoad,
  isPasswordRecoveryPath,
  signedInDestination,
} from "~/lib/auth-redirects";

/**
 * The auth pages: sign in, sign up, and password recovery.
 *
 * They sit outside `_dashboard` precisely because that boundary is
 * `ssr: false`. With the server unable to render anything under it, `/sign-in`
 * used to ship the dashboard's pending shell — a sidebar skeleton and a
 * spinner — and the visitor waited for the whole client bundle to download,
 * parse, and hydrate before the form existed at all. That is the one page in
 * the product nobody can skip, and nothing on it needs a session to render:
 * the form is static, and the session only decides whether to redirect.
 *
 * The provider stack is the minimum this surface uses, and every part of it is
 * server-safe. `AuthProvider` renders a loading context on the server;
 * `ToastProvider` is where the forms report failures through `toastManager`.
 * `ThemeProvider` is deliberately absent — its initializers read `localStorage`
 * and `document`, and the theme is already applied to `<html>` by the
 * document's pre-hydration script, so nothing here renders from it.
 *
 * Two auth routes stay under `_dashboard`: `/email-verify` and
 * `/reset-password`. Their loaders fetch the one-time-code endpoint with
 * `credentials: "include"`, which only the visitor's browser can send to the
 * API origin, so they cannot move to the server.
 */
export const Route = createFileRoute("/_auth")({
  beforeLoad: authPageBeforeLoad,
  head: () => ({ meta: [{ title: "Feeblo" }] }),
  component: AuthBoundary,
});

function AuthBoundary() {
  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  return (
    <AuthProvider hydrationSafe>
      <AuthPageRedirect />
      <ToastProvider>
        <AnchoredToastProvider>
          <Outlet />
        </AnchoredToastProvider>
      </ToastProvider>
    </AuthProvider>
  );
}

/**
 * The cold-load half of `authPageBeforeLoad`.
 *
 * `beforeLoad` runs on the server for a server-rendered document, where the
 * visitor's session is not available (the document is shared and the server
 * cannot read the session cookie), so it decides nothing there — and the client
 * reuses that answer during hydration instead of re-running the hook. Without
 * this, the first load of `/sign-in` would never check for an existing
 * session, while a client-side navigation to the same page would. Both now
 * send a signed-in visitor to the same place, at the same point: once the atom
 * has a confirmed session.
 *
 * A visitor whose session is still resolving sees the form for one round trip
 * before this fires. That is the trade for painting the form immediately
 * instead of the full-page loader this route used to show for several.
 */
function AuthPageRedirect() {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
  }, []);

  // The session atom subscribes to `window` signals, so it cannot be read while
  // the server renders the document, and flipping the tree after mount keeps
  // the first client render identical to the server's (nothing).
  return hydrated ? <SignedInRedirect /> : null;
}

function SignedInRedirect() {
  const auth = useResolvedAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  // A string, not the session object: the atom hands back a fresh object per
  // evaluation, so depending on it would re-run the redirect every render.
  const destination =
    auth.status === "authenticated" && auth.data !== null
      ? signedInDestination(auth.data)
      : null;

  useEffect(() => {
    if (destination === null || isPasswordRecoveryPath(pathname)) {
      return;
    }

    void navigate({ href: destination, replace: true });
  }, [destination, navigate, pathname]);

  return null;
}
