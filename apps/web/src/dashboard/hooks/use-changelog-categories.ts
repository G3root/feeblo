import { eq, useLiveQuery } from "@tanstack/react-db";

import { changelogCategoryCollection } from "~/lib/collections";

/** The organization's changelog categories, oldest first. */
export function useChangelogCategories(organizationId: string) {
  return useLiveQuery({
    queryKey: [
      "changelog-categories",
      changelogCategoryCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) => eq(category.organizationId, organizationId))
        .orderBy(({ category }) => category.createdAt, "asc"),
  });
}
