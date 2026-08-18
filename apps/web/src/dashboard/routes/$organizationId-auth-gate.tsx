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

    // A full navigation lets middleware verify the next document and preserves
    // this deep link for the post-login redirect.
    const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const signInUrl = new URL("/sign-in", window.location.origin);
    signInUrl.searchParams.set("redirectTo", redirectTo);
    window.location.assign(signInUrl.toString());
  }, [auth.status]);

  if (auth.status === "authenticated") {
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
