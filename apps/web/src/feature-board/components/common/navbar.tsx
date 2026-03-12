import { Link, useLocation } from "wouter";
import { Button } from "~/components/ui/button";
import { authClient } from "~/lib/auth-client";
import { cn } from "~/lib/utils";
import { useSite } from "../../providers/site-provider";
import { AuthDialog } from "./auth-dialog";

export function Navbar() {
  const site = useSite();

  return (
    <header className="border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4 sm:h-16">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex flex-col">
              <h1 className="truncate font-semibold text-sm tracking-tight sm:text-base">
                {site.name}
              </h1>
            </div>

            <nav className="hidden items-center gap-4 text-muted-foreground text-sm sm:flex">
              <NavTab href="/" label="Feedback" />
              <NavTab href="/roadmap" label="Roadmap" />
              <NavTab href="/changelog" label="Changelog" />
            </nav>
          </div>

          <div className="flex shrink-0 items-center">
            <UserActions />
          </div>
        </div>

        <nav className="flex items-center gap-4 pb-2 text-muted-foreground text-sm sm:hidden">
          <NavTab href="/" label="Feedback" />
          <NavTab href="/roadmap" label="Roadmap" />
          <NavTab href="/changelog" label="Changelog" />
        </nav>
      </div>
    </header>
  );
}

function NavTab({ href, label }: { href: string; label: string }) {
  const [location] = useLocation();
  const isActive = location === href;

  return (
    <Link
      className={cn(
        "relative flex items-center px-1.5 text-sm transition-colors hover:text-foreground",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}
      href={href}
    >
      <span>{label}</span>
      {isActive ? (
        <span className="absolute inset-x-1 -bottom-2 h-0.5 rounded-full bg-foreground/80" />
      ) : null}
    </Link>
  );
}

function UserActions() {
  const { data: session } = authClient.useSession();
  return (
    <div className="flex items-center gap-2">
      {session ? (
        <Button size="sm" variant="outline">
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
