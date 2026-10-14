import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * The organization's companies. Consumers that need a different order sort
 * locally so the list page, contact page, and pickers share one shape.
 */
export function useOrgCompanies(organizationId: string) {
  const { companyCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: ["org-companies", companyCollection.id, organizationId],
    query: (q) =>
      q
        .from({ company: companyCollection })
        .where(({ company }) => eq(company.organizationId, organizationId)),
  });
}
