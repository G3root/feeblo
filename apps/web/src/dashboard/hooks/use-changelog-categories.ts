import { eq, useLiveQuery } from "@tanstack/react-db";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/** The organization's changelog categories, oldest first. */
export function useChangelogCategories(organizationId: string) {
  const { changelogCategoryCollection } = useDashboardCollections();
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
