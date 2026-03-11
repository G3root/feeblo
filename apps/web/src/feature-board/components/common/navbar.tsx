import { Link, useLocation } from "wouter";
import { buttonVariants } from "~/components/ui/button";
import { useSite } from "../../providers/site-provider";

export function Navbar() {
  const site = useSite();
  const [location] = useLocation();
  const pathname = location || "/";
  const isFeedbackRoute = pathname === "/" || pathname.startsWith("/p/");
  const isRoadmapRoute = pathname === "/roadmap";

  return (
    <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <div className="min-w-0">
          <Link className="block min-w-0 font-medium text-sm" href="/">
            <span className="block truncate">{site.name}</span>
            <span className="block text-muted-foreground text-xs">
              Public feedback board
            </span>
          </Link>
        </div>

        <nav className="flex flex-wrap items-center gap-1">
          <Link
            className={buttonVariants({
              size: "sm",
              variant: isFeedbackRoute ? "default" : "ghost",
            })}
            href="/"
          >
            Feedback
          </Link>
          <Link
            className={buttonVariants({
              size: "sm",
              variant: isRoadmapRoute ? "default" : "ghost",
            })}
            href="/roadmap"
          >
            Roadmap
          </Link>
        </nav>
      </div>
    </header>
  );
}
