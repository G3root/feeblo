import { eq, useLiveQuery } from "@tanstack/react-db";

import { contactCollection } from "~/lib/collections";

/**
 * The organization's contacts. Consumers that need a different order sort
 * locally so the list page, company page, and pickers share one shape.
 */
export function useOrgContacts(organizationId: string) {
  return useLiveQuery({
    queryKey: ["org-contacts", contactCollection.id, organizationId],
    query: (q) =>
      q
        .from({ contact: contactCollection })
        .where(({ contact }) => eq(contact.organizationId, organizationId)),
  });
}
