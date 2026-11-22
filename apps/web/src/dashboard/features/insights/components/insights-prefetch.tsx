import { useAtomMount } from "@effect/atom-react";
import type { TInsightsRange } from "@feeblo/domain/insights/schema";

import { workspaceInsightsAtom, workspaceTrafficAtom } from "../atoms";

/**
 * Mounts both insights reads for a window without subscribing to either.
 *
 * Hovering or focusing a control that switches the page's window — the sidebar
 * entry, a range option — starts its two server round trips before the click,
 * so the switch joins an in-flight request instead of starting one. The
 * component subscribes to nothing, so it cannot re-render whatever mounted it
 * when a result arrives; an unmounted prefetch keeps running because both
 * atoms carry an idle TTL.
 */
export function InsightsPrefetch({
  organizationId,
  range,
}: {
  readonly organizationId: string;
  readonly range: TInsightsRange;
}) {
  useAtomMount(workspaceInsightsAtom({ organizationId, range }));
  useAtomMount(workspaceTrafficAtom({ organizationId, range }));

  return null;
}
