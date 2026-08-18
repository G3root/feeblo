import { eq, useLiveQuery } from "@tanstack/react-db";

import { usePublicCollections } from "../../providers/public-collections-provider";

export function ChangelogCategoryBadges({
  categoryIds,
}: {
  categoryIds: readonly string[];
}) {
  if (categoryIds.length === 0) {
    return null;
  }

  return (
    <span className="flex flex-wrap gap-1.5">
      {categoryIds.map((categoryId) => (
        <ChangelogCategoryBadge categoryId={categoryId} key={categoryId} />
      ))}
    </span>
  );
}

export function ChangelogCategoryBadge({ categoryId }: { categoryId: string }) {
  const { publicChangelogCategoryCollection } = usePublicCollections();

  const categoryQuery = useLiveQuery(
    (q) =>
      q
        .from({ category: publicChangelogCategoryCollection })
        .where(({ category }) => eq(category.id, categoryId))
        .findOne(),
    [categoryId]
  );

  const category = categoryQuery.data;

  if (!category) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in oklab, ${category.icon} 12%, transparent)`,
        color: category.icon,
      }}
    >
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: category.icon }}
      />
      <span>{category.name}</span>
    </span>
  );
}
