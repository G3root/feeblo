import { eq, useLiveQuery } from "@tanstack/react-db";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useOrganizationId } from "./use-organization-id";

export const usePlan = () => {
  const organizationId = useOrganizationId();
  const { workspacePlanCollection } = useDashboardCollections();

  const query = useLiveQuery(
    (q) =>
      q
        .from({ plan: workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId))
        .findOne(),
    [organizationId]
  );

  return query;
};
