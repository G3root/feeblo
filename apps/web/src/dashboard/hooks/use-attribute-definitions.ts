import { eq, useLiveQuery } from "@tanstack/react-db";

import {
  companyAttributeDefinitionCollection,
  contactAttributeDefinitionCollection,
} from "~/lib/collections";

/**
 * The organization's attribute definitions, oldest first. The contact and
 * company collections have the same shape, so each hook is the same query
 * with its own identity.
 */
export function useContactAttributeDefinitions(organizationId: string) {
  return useLiveQuery({
    queryKey: [
      "attribute-definitions",
      contactAttributeDefinitionCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ attribute: contactAttributeDefinitionCollection })
        .where(({ attribute }) => eq(attribute.organizationId, organizationId))
        .orderBy(({ attribute }) => attribute.createdAt, "asc"),
  });
}

export function useCompanyAttributeDefinitions(organizationId: string) {
  return useLiveQuery({
    queryKey: [
      "attribute-definitions",
      companyAttributeDefinitionCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ attribute: companyAttributeDefinitionCollection })
        .where(({ attribute }) => eq(attribute.organizationId, organizationId))
        .orderBy(({ attribute }) => attribute.createdAt, "asc"),
  });
}
