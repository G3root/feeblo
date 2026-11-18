import { createContext, type ReactNode, useContext } from "react";

import type { WorkspaceSlugAvailability } from "../hooks/use-workspace-slug-availability";

/**
 * The page's one slash-availability machine, for the two places that read it.
 *
 * The register page owns the check because two subtrees render its answer: the
 * form field's footer ("Name is available", the suggestion button) and the
 * preview's address bar. Passing it down through `withForm`'s `props` would
 * have meant inventing a default value for a prop the page always supplies — a
 * no-op `reportWorkspaceName` that silently drops input if the wiring ever
 * slipped — so the value travels through context instead, where "not provided"
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

export function useSlugAvailability(): WorkspaceSlugAvailability {
  const value = useContext(SlugAvailabilityContext);

  if (value === null) {
    throw new Error(
      "useSlugAvailability must be used inside SlugAvailabilityProvider"
    );
  }

  return value;
}
