import { AuthButton } from "@feeblo/post-ui/auth-dialog";
import { NotificationsMenu } from "@feeblo/post-ui/notifications-menu";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { useAuth } from "@feeblo/web-shared/auth-context";
import { Link, useLocation } from "@tanstack/react-router";

import { useSite } from "../../providers/site-provider";
import { UserMenu } from "./user-menu";

export function Navbar() {
  const site = useSite();

  return (
    <header className="bg-background/80 border-b backdrop-blur-sm">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-14 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex min-w-0 items-center gap-2">
              <UserAvatar image={site.logo} name={site.name} />
              <h1 className="truncate text-sm font-semibold tracking-tight sm:text-base">
                {site.name}
              </h1>
            </div>

            <nav className="text-muted-foreground hidden items-center gap-4 self-stretch text-sm sm:flex">
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

        <nav className="text-muted-foreground flex items-center gap-4 pb-2 text-sm sm:hidden">
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
  const isActive =
    pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));

  return (
    <Link
      className={cn(
        "hover:text-foreground relative flex items-center px-1.5 text-sm transition-colors sm:h-full",
        isActive ? "text-foreground" : "text-muted-foreground"
      )}
      to={href}
    >
      <span>{label}</span>
      {isActive ? (
        <span className="bg-foreground/80 absolute inset-x-1 -bottom-2 h-0.5 rounded-full sm:-bottom-4" />
      ) : null}
    </Link>
  );
}

function UserActions() {
  const site = useSite();
  const auth = useAuth();
  const isAuthenticated = auth.status === "authenticated";

  return (
    <div className="flex items-center gap-2">
      {isAuthenticated ? (
        <>
          <NotificationsMenu organizationId={site.organizationId} />
          <UserMenu />
        </>
      ) : (
        <AuthButton />
      )}
    </div>
  );
}
