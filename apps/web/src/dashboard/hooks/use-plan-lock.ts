import { eq, useLiveQuery } from "@tanstack/react-db";

import { dashboardCollections } from "~/lib/collections";

import { useOrganizationId } from "./use-organization-id";

/**
 * The workspace's computed plan lock: which resources the free plan blocks
 * now (`current`) and which it would block if the workspace fell to free
 * (`preview`). One row per organization; absent until the layout preload or
 * the first read resolves.
 */
export const usePlanLock = () => {
  const organizationId = useOrganizationId();

  return useLiveQuery({
    queryKey: [
      "plan-lock",
      dashboardCollections.workspacePlanLockCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ lock: dashboardCollections.workspacePlanLockCollection })
        .where(({ lock }) => eq(lock.organizationId, organizationId))
        .findOne(),
  });
};
