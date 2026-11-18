import { createContext, type ReactNode, useContext } from "react";

import type { WorkspaceSlugAvailability } from "../hooks/use-slug-availability";

/**
 * The page's one slug-availability machine, for the two places that read it.
 *
 * The url step renders the verdict in the field's footer, and the preview
 * renders it in the address bar. Passing it down through `withForm`'s `props`
 * would have meant inventing a default value for an object the page always
 * supplies, so the value travels through context instead, where "not provided"
 * is an error rather than a plausible-looking lie.
 */
const SlugAvailabilityContext = createContext<WorkspaceSlugAvailability | null>(
  null
);

export function SlugAvailabilityProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value: WorkspaceSlugAvailability;
}) {
  return (
    <SlugAvailabilityContext value={value}>{children}</SlugAvailabilityContext>
  );
}

export function useSlugAvailabilityContext(): WorkspaceSlugAvailability {
  const value = useContext(SlugAvailabilityContext);

  if (value === null) {
    throw new Error(
      "useSlugAvailabilityContext must be used inside SlugAvailabilityProvider"
    );
  }

  return value;
}
