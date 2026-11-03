import { useMachine } from "@xstate/react";
import { useEffect } from "react";

import {
  type SlugAvailability,
  slugAvailabilityMachine,
  toSlugAvailability,
} from "../lib/slug-availability-machine";

/**
 * Reports whether a workspace slug is available, debounced.
 *
 * The lifecycle lives in `slug-availability-machine.ts`; this hook is the
 * adapter between React's render cycle and the machine's events. Sending
 * `INPUT` is all it does on a render, and the machine decides whether that
 * means "arm a check", "cancel the one in flight", or "there is nothing to
 * ask" — the three branches the previous implementation interleaved into one
 * effect.
 */
export function useWorkspaceSlugAvailability(
  slug: string,
  enabled: boolean
): SlugAvailability {
  const [snapshot, send] = useMachine(slugAvailabilityMachine);

  useEffect(() => {
    send({ type: "INPUT", enabled, slug });
  }, [enabled, send, slug]);

  return toSlugAvailability(snapshot);
}
