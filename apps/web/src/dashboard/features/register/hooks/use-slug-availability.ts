import { useMachine } from "@xstate/react";
import { useCallback } from "react";

import {
  type SlugAvailability,
  slugAvailabilityMachine,
  toSlugAvailability,
} from "../lib/slug-availability-machine";
import { MIN_SLUG_LENGTH } from "../utils";

/** What a subdomain field needs from this hook. */
export type WorkspaceSlugAvailability = {
  readonly availability: SlugAvailability;
  /** Called by whoever changes the subdomain; the lifecycle's only input event. */
  readonly reportSlug: (subdomain: string) => void;
};

/**
 * Reports whether a subdomain is available, debounced.
 *
 * The lifecycle lives in `slug-availability-machine.ts`; this hook is the
 * adapter between React's render cycle and the machine's events. The machine is
 * seeded with the value already in the field, and every later change is
 * reported by whoever made it (`reportSlug`), which is an event handler and not
 * a subscription to a value that has already changed by the time an effect
 * runs.
 *
 * That distinction is the whole point. An effect that mirrors a value into an
 * actor runs after paint, so it can report a subdomain the field no longer
 * shows, and it must be written carefully enough not to loop. A handler cannot
 * do either.
 *
 * The slug is the reader's now, not one derived from the workspace name, so
 * this takes the string the field holds and never computes one.
 */
export function useSlugAvailability(
  initialSlug: string
): WorkspaceSlugAvailability {
  const [snapshot, send] = useMachine(slugAvailabilityMachine, {
    input: {
      enabled: initialSlug.length >= MIN_SLUG_LENGTH,
      slug: initialSlug,
    },
  });

  const reportSlug = useCallback(
    (nextSlug: string) => {
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
    reportSlug,
  };
}
