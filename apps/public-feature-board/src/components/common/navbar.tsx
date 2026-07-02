import { Button } from "@feeblo/ui/button";
import { cn } from "@feeblo/ui/utils";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { Link, useLocation } from "@tanstack/react-router";
import { useSite } from "../../providers/site-provider";
import { AuthDialog } from "./auth-dialog";

export function Navbar() {
  const site = useSite();

  return (
    <header className="border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4 sm:h-16">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex flex-col">
              <h1 className="truncate font-semibold text-sm tracking-tight sm:text-base">
                {site.name}
              </h1>
            </div>

            <nav className="hidden items-center gap-4 text-muted-foreground text-sm sm:flex">
              <NavTab href="/" label="Feedback" />
              {site.roadmapVisibility === "PUBLIC" ? (
                <NavTab href="/roadmap" label="Roadmap" />
              ) : null}
              {site.changelogVisibility === "PUBLIC" ? (
                <NavTab href="/changelog" label="Changelog" />
              ) : null}
            </nav>
          </div>

          <div className="flex shrink-0 items-center">
            <UserActions />
          </div>
        </div>

        <nav className="flex items-center gap-4 pb-2 text-muted-foreground text-sm sm:hidden">
          <NavTab href="/" label="Feedback" />
          {site.roadmapVisibility === "PUBLIC" ? (
            <NavTab href="/roadmap" label="Roadmap" />
          ) : null}
          {site.changelogVisibility === "PUBLIC" ? (
            <NavTab href="/changelog" label="Changelog" />
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function NavTab({ href, label }: { href: string; label: string }) {
  const { pathname } = useLocation();
  const isActive = pathname === href;

  return (
    <Link
      className={cn(
        "relative flex items-center px-1.5 text-sm transition-colors hover:text-foreground",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}
      to={href}
    >
      <span>{label}</span>
      {isActive ? (
        <span className="absolute inset-x-1 -bottom-2 h-0.5 rounded-full bg-foreground/80" />
      ) : null}
    </Link>
  );
}

function UserActions() {
  const { data: session } = useAuthState();
  return (
    <div className="flex items-center gap-2">
      {session ? (
        <Button
          onClick={async () => {
            await authClient.signOut();
          }}
          size="sm"
          variant="outline"
        >
          Sign out
        </Button>
      ) : (
        <>
          <AuthDialog variant="sign-in" />
          <AuthDialog variant="sign-up" />
        </>
      )}
    </div>
  );
}
