import { useMachine } from "@xstate/react";
import { useCallback } from "react";

import {
  type SlugAvailability,
  slugAvailabilityMachine,
  toSlugAvailability,
} from "../lib/slug-availability-machine";
import { MIN_SLUG_LENGTH, toWorkspaceSlug } from "../utils";

/** What the slug field needs from this hook. */
export type WorkspaceSlugAvailability = {
  readonly availability: SlugAvailability;
  /** Called by whoever changes the name; the lifecycle's only input event. */
  readonly reportWorkspaceName: (workspaceName: string) => void;
};

/**
 * Reports whether a workspace slug is available, debounced.
 *
 * The lifecycle lives in `slug-availability-machine.ts`; this hook is the
 * adapter between React's render cycle and the machine's events. Calling it
 * is not an effect: the machine is seeded with the name already in the form,
 * and every later change is reported by whoever made it
 * (`reportWorkspaceName`), which is an event handler — not a subscription to a
 * value that has already changed by the time an effect runs.
 *
 * That distinction is the whole point. An effect that mirrors a derived value
 * into an actor runs after paint, so it can report a slug the field no longer
 * shows, and it must be written carefully enough not to loop. A handler cannot
 * do either.
 */
export function useWorkspaceSlugAvailability(
  workspaceName: string
): WorkspaceSlugAvailability {
  const slug = toWorkspaceSlug(workspaceName);
  const [snapshot, send] = useMachine(slugAvailabilityMachine, {
    input: { enabled: slug.length >= MIN_SLUG_LENGTH, slug },
  });

  const reportWorkspaceName = useCallback(
    (nextWorkspaceName: string) => {
      const nextSlug = toWorkspaceSlug(nextWorkspaceName);
      send({
        type: "INPUT",
        enabled: nextSlug.length >= MIN_SLUG_LENGTH,
        slug: nextSlug,
      });
    },
    [send]
  );

  return {
    availability: toSlugAvailability(snapshot),
    reportWorkspaceName,
  };
}
