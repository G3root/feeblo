import { eq, useLiveQuery } from "@tanstack/react-db";

import { dashboardCollections } from "~/lib/collections";

import { useOrganizationId } from "./use-organization-id";

export const usePlan = () => {
  const organizationId = useOrganizationId();

  const query = useLiveQuery({
    query: (q) =>
      q
        .from({ plan: dashboardCollections.workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId))
        .findOne(),
  });

  return query;
};
