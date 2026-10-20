import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useOrganizationId } from "../../../hooks/use-organization-id";

/**
 * The workspace's over-plan findings, and whether the gate should engage.
 *
 * One row per workspace; the organization route preloads the collection, so
 * the gate and the banner read the same snapshot without a second request.
 */
export const usePlanCompliance = () => {
  const organizationId = useOrganizationId();
  const { planComplianceCollection } = useDashboardCollections();

  const query = useLiveQuery({
    queryKey: ["plan-compliance", planComplianceCollection.id, organizationId],
    query: (q) =>
      q
        .from({ compliance: planComplianceCollection })
        .where(({ compliance }) =>
          eq(compliance.organizationId, organizationId)
        )
        .findOne(),
  });

  const compliance = query.data;

  return {
    ...query,
    compliance,
    isOverPlan: compliance !== undefined && compliance.violations.length > 0,
  };
};
