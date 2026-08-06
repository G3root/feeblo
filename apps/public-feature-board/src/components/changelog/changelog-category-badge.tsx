import { eq, useLiveQuery } from "@tanstack/react-db";
import { usePublicCollections } from "../../providers/public-collections-provider";

export function ChangelogCategoryBadge({
  categoryId,
}: {
  categoryId: string | null;
}) {
  const { publicChangelogCategoryCollection } = usePublicCollections();

  const categoryQuery = useLiveQuery(
    (q) => {
      if (!categoryId) {
        return undefined;
      }
      return q
        .from({ category: publicChangelogCategoryCollection })
        .where(({ category }) => eq(category.id, categoryId))
        .findOne();
    },
    [categoryId]
  );

  const category = categoryQuery.data;

  if (!category) {
    return null;
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium text-xs"
      style={{
        backgroundColor: `${category.icon}1f`,
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
