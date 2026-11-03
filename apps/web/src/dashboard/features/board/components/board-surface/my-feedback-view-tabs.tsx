import { toggleVariants } from "@feeblo/ui/toggle";
import { Link } from "@tanstack/react-router";

import { MY_FEEDBACK_VIEWS } from "../../lib/my-feedback-views";

/**
 * The member's own feedback page: two fixed views and nothing to create.
 *
 * Deliberately not `ViewTabStrip`. That strip exists to measure and clip a set
 * that grows — the built-in presets plus every saved view on the surface — and
 * to keep a drag order across the member's own pills. Here the set is two short
 * labels that always fit the row the toolbar gives them, and the page has no
 * saved views at all, so there is nothing to measure, clip, reorder or create.
 * Reusing the strip would mean passing it an empty view list and a disabled
 * create button to arrive at the same two links.
 *
 * The current view is the route, so `Link`'s own active state is the whole
 * answer; no `activeView.id` matching is needed.
 */
export function MyFeedbackViewTabs({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <Link
        activeOptions={{ exact: true }}
        activeProps={{ "data-pressed": "true" }}
        className={toggleVariants({ size: "sm", variant: "outline" })}
        params={{ organizationId }}
        to="/$organizationId/my-feedback"
      >
        {MY_FEEDBACK_VIEWS.created.name}
      </Link>
      <Link
        activeOptions={{ exact: true }}
        activeProps={{ "data-pressed": "true" }}
        className={toggleVariants({ size: "sm", variant: "outline" })}
        params={{ organizationId }}
        to="/$organizationId/my-feedback/assigned"
      >
        {MY_FEEDBACK_VIEWS.assigned.name}
      </Link>
    </div>
  );
}
