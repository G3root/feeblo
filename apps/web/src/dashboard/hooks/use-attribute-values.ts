import { eq, useLiveQuery } from "@tanstack/react-db";

import {
  companyAttributeValueCollection,
  contactAttributeValueCollection,
} from "~/lib/collections";

/**
 * Attribute values for one contact/company. These run once per table row, so
 * the explicit keys keep a list render from rebuilding each row's IR.
 */
export function useContactAttributeValues(contactId: string) {
  return useLiveQuery({
    queryKey: [
      "contact-attribute-values",
      contactAttributeValueCollection.id,
      contactId,
    ],
    query: (q) =>
      q
        .from({ value: contactAttributeValueCollection })
        .where(({ value }) => eq(value.contactId, contactId)),
  });
}

export function useCompanyAttributeValues(companyId: string) {
  return useLiveQuery({
    queryKey: [
      "company-attribute-values",
      companyAttributeValueCollection.id,
      companyId,
    ],
    query: (q) =>
      q
        .from({ value: companyAttributeValueCollection })
        .where(({ value }) => eq(value.companyId, companyId)),
  });
}
