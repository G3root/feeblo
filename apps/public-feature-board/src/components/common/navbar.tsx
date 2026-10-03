import { AuthButton } from "@feeblo/post-ui/auth-dialog";
import { NotificationsMenu } from "@feeblo/post-ui/notifications-menu";
import { UserAvatar } from "@feeblo/ui/user-avatar";
import { cn } from "@feeblo/ui/utils";
import { useAuth } from "@feeblo/web-shared/auth-context";
import { Link, useLocation } from "@tanstack/react-router";

import { boardPaths, toBoardPublicPath } from "../../lib/board-links";
import { m } from "../../paraglide/messages.js";
import { useSite } from "../../providers/site-provider";
import { LocaleSwitcher } from "./locale-switcher";
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
              <NavTab
                href={boardPaths.home}
                label={m.caring_brave_orangutan()}
              />
              {site.roadmapVisibility === "PUBLIC" ? (
                <NavTab
                  href={boardPaths.roadmap}
                  label={m.slimy_stale_blackbird()}
                />
              ) : null}
              {site.changelogVisibility === "PUBLIC" ? (
                <NavTab
                  href={boardPaths.changelog}
                  label={m.strong_loved_flamingo()}
                />
              ) : null}
            </nav>
          </div>

          <div className="flex shrink-0 items-center">
            <UserActions />
          </div>
        </div>

        <nav className="text-muted-foreground flex items-center gap-4 pb-2 text-sm sm:hidden">
          <NavTab href={boardPaths.home} label={m.caring_brave_orangutan()} />
          {site.roadmapVisibility === "PUBLIC" ? (
            <NavTab
              href={boardPaths.roadmap}
              label={m.slimy_stale_blackbird()}
            />
          ) : null}
          {site.changelogVisibility === "PUBLIC" ? (
            <NavTab
              href={boardPaths.changelog}
              label={m.strong_loved_flamingo()}
            />
          ) : null}
        </nav>
      </div>
    </header>
  );
}

function NavTab({ href, label }: { href: string; label: string }) {
  // The location keeps the internal `/s/...` spelling, so both sides are
  // translated onto the visitor's spelling before matching — otherwise the
  // home tab (`/s`) prefixes every board route and stays selected everywhere.
  const currentPath = toBoardPublicPath(useLocation().pathname);
  const publicHref = toBoardPublicPath(href);
  const isActive =
    publicHref === "/"
      ? currentPath === "/"
      : currentPath === publicHref || currentPath.startsWith(`${publicHref}/`);

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
      <LocaleSwitcher />
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
