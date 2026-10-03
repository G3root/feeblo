import { useDbClient } from "@tanstack/react-db";
import { useCallback, useMemo } from "react";

import {
  BOARD_SCOPE_DEPENDENCY,
  type BoardScope,
  requireMutationOrganizationId,
} from "../lib/board-scope";
import {
  createPublicCollections,
  type PublicCollections,
} from "../lib/collections";

/**
 * The board's collections for the current `DbClient`.
 *
 * The board's components (and `post-ui` through them) keep receiving
 * *instances*, exactly as they did when the collections were module-level
 * singletons. The difference is that the instances belong to the request's or
 * document's client, so a server render and a browser document never share
 * collection state, and mutations always target the instance the surrounding
 * surface reads from.
 */
export function usePublicCollections(): PublicCollections {
  const dbClient = useDbClient();

  return useMemo(() => createPublicCollections(dbClient), [dbClient]);
}

/**
 * Organization id for board mutations.
 *
 * Validated against the restricted SSO session at call time, so it is a
 * function rather than a value: a session can change after the page loaded.
 */
export function useBoardMutationOrganizationId(): () => string {
  const dbClient = useDbClient();

  return useCallback(
    () =>
      requireMutationOrganizationId(
        dbClient.requireDependency<BoardScope>(BOARD_SCOPE_DEPENDENCY)
      ),
    [dbClient]
  );
}
