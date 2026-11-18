import { useAtomValue } from "@effect/atom-react";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Cancel01Icon, SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Result from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { workspaceOnboardingSummaryAtom } from "../atoms";

/**
 * Tells a reader that the posts on the page arrived with the workspace.
 *
 * The count comes from `workspaceOnboardingSummaryAtom` — one read per
 * workspace, cached — rather than from the post collection: the collection
 * holds every post, and "how many of these did we write for you" is not a
 * question a filter over it answers cheaply on a board with thousands of rows.
 *
 * Renders nothing at all in the states nobody can act on: still loading, the
 * read failed, or there are no samples left. An empty banner container would
 * leave a gap on every dashboard that has moved on.
 */
export function OnboardingSampleBanner({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const summary = useAtomValue(workspaceOnboardingSummaryAtom(organizationId));

  const [dismissed, setDismissed] = useState(false);

  if (dismissed) {
    return null;
  }

  return Result.builder(summary)
    .onInitial(() => null)
    .onFailure(() => null)
    .onSuccess(({ samplePostCount }) =>
      samplePostCount === 0 ? null : (
        <Alert className="items-center">
          <HugeiconsIcon icon={SparklesIcon} />
          <AlertTitle>Sample data</AlertTitle>
          <AlertDescription>
            {samplePostCount === 1
              ? "One sample post is left. Edit it, or delete it once you have seen how it works."
              : `${samplePostCount} sample posts are left. Edit them, or delete them once you have seen how they work.`}
          </AlertDescription>
          <AlertAction>
            <Button
              aria-label="Dismiss sample data notice"
              onClick={() => setDismissed(true)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </AlertAction>
        </Alert>
      )
    )
    .exhaustive();
}
