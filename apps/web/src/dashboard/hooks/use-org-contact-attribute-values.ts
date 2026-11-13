import { useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Every contact attribute value in the workspace, in one live query.
 *
 * The CRM table renders one column per attribute definition, so the per-row
 * hook (`useContactAttributeValues`) would run one query per row *per column*.
 * The collection is already scoped to the organization, so a single query
 * answers the whole table and the cells read it from a map.
 */
export function useOrgContactAttributeValues(organizationId: string) {
  const { contactAttributeValueCollection } = useDashboardCollections();
  return useLiveQuery({
    queryKey: [
      "org-contact-attribute-values",
      contactAttributeValueCollection.id,
      organizationId,
    ],
    query: (q) => q.from({ value: contactAttributeValueCollection }),
  });
}
