import { z } from "zod";

/**
 * The insights window, carried in the URL.
 *
 * The feedback and help center tabs are sibling routes, so each mounts its own
 * `InsightsPage`; a window held in that component would be recreated with the
 * default every time the tabs switch. In the route's search params it survives
 * the switch, and a shared link opens on the window it names. An unreadable
 * value falls back to "no preference" rather than failing the route, so a
 * stale bookmark still opens the page.
 */
export const insightsSearchSchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).optional().catch(undefined),
});
