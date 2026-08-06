import { SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import type { ChangelogStatus } from "../constants";
import { ChangelogStatusBadge } from "./changelog-status";

type TChangelogListItem = {
  id: string;
  title: string;
  slug: string;
  content: string;
  status: ChangelogStatus;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  updatedAt: Date;
  user: {
    name: string | null;
  };
};

const headItems = [
  "Title",
  "Category",
  "Author",
  "Status",
  "Publish date",
  "Updated",
];

export function ChangelogListView({
  changelogs,
  organizationId,
}: {
  changelogs: TChangelogListItem[];
  organizationId: string;
}) {
  const { changelogCategoryCollection, changelogCategoryLinkCollection } =
    useDashboardCollections();
  const categoriesQuery = useLiveQuery(
    (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) => eq(category.organizationId, organizationId)),
    [organizationId]
  );
  const categories = categoriesQuery.data ?? [];
  const categoryById = new Map(
    categories.map((category) => [category.id, category])
  );

  const linksQuery = useLiveQuery(
    (q) =>
      q
        .from({ link: changelogCategoryLinkCollection })
        .where(({ link }) => eq(link.organizationId, organizationId)),
    [organizationId]
  );
  const links = linksQuery.data ?? [];
  const categoryIdsByChangelog = new Map<string, string[]>();
  for (const link of links) {
    const ids = categoryIdsByChangelog.get(link.changelogId) ?? [];
    ids.push(link.categoryId);
    categoryIdsByChangelog.set(link.changelogId, ids);
  }

  return (
    <div className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            {headItems.map((item) => (
              <TableHead key={item}>
                <SkeletonWrapper>{item}</SkeletonWrapper>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {changelogs.map((changelog) => {
            const changelogCategories = (
              categoryIdsByChangelog.get(changelog.id) ?? []
            )
              .map((categoryId) => categoryById.get(categoryId))
              .filter(
                (category): category is NonNullable<typeof category> =>
                  category !== undefined
              );

            return (
              <TableRow key={changelog.id}>
                <TableCell>
                  <Link
                    params={{ organizationId, changelogSlug: changelog.slug }}
                    to="/$organizationId/changelog/edit/$changelogSlug"
                  >
                    {changelog.title}
                  </Link>
                </TableCell>
                <TableCell>
                  {changelogCategories.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {changelogCategories.map((category) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium text-xs"
                          key={category.id}
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
                          {category.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>{changelog.user.name ?? "Unknown"}</TableCell>
                <TableCell>
                  <ChangelogStatusBadge status={changelog.status} />
                </TableCell>
                <TableCell>
                  {formatPublishDate(
                    changelog.publishedAt,
                    changelog.scheduledAt
                  )}
                </TableCell>
                <TableCell>{formatDate(changelog.updatedAt)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function formatPublishDate(publishedAt: Date | null, scheduledAt: Date | null) {
  const value = publishedAt ?? scheduledAt;

  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}
