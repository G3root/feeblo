import { buttonVariants } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { Link } from "@tanstack/react-router";

import { m } from "@/paraglide/messages.js";

/**
 * The router-wide 404 document.
 *
 * It is the root route's `notFoundComponent`, so it renders outside every
 * layout that could provide the dashboard's providers — and on the dashboard
 * host that is the point: an unknown URL should be a page, not a bare
 * "Not Found" paragraph. Board hosts have their own, board-aware 404 in
 * `routes/s/route.tsx`, which the fuzzy not-found boundary prefers for the
 * routes under `/s`.
 */
export function RouteNotFoundPage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
      <Empty className="border-border/70 bg-muted/20 w-full max-w-md border border-dashed">
        <EmptyHeader>
          <span className="text-muted-foreground font-mono text-xs tracking-[0.25em]">
            404
          </span>
          <EmptyTitle>{m.salty_empty_shrike()}</EmptyTitle>
          <EmptyDescription>
            {m.not_found_description_generic()}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Link className={buttonVariants({ variant: "outline" })} to="/">
            {m.not_found_go_to_dashboard()}
          </Link>
        </EmptyContent>
      </Empty>
    </main>
  );
}
