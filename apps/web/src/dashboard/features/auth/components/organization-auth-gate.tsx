import { useAuth } from "@feeblo/web-shared/auth-context";
import { type ReactNode, useEffect } from "react";

function Loading({ label }: { readonly label: string }) {
  return (
    <div className="text-muted-foreground flex min-h-screen items-center justify-center text-sm">
      {label}
    </div>
  );
}

export function AuthGate({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== "unauthenticated") {
      return;
    }

    // A full navigation re-runs the root auth guard against a fresh session
    // resolution and preserves this deep link for the post-login redirect.
    const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const signInUrl = new URL("/sign-in", window.location.origin);
    signInUrl.searchParams.set("redirectTo", redirectTo);
    window.location.assign(signInUrl.toString());
  }, [auth.status]);

  // Hint-painted state (data null) is display-only: protected children wait
  // for the atom's authoritative session.
  if (auth.status === "authenticated" && auth.data !== null) {
    return <>{children}</>;
  }

  return (
    <Loading
      label={
        auth.status === "unauthenticated"
          ? "Redirecting to sign in…"
          : "Loading…"
      }
    />
  );
}
