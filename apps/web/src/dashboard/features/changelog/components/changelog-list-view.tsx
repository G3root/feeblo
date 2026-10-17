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

// Narrow screens keep the title and status — the two columns that answer
// "what is it" and "where is it" — and drop the rest. The table can still
// scroll horizontally, but six columns on a phone leaves every cell clipped.
const headItems = [
  { label: "Title", className: "" },
  { label: "Category", className: "hidden sm:table-cell" },
  { label: "Author", className: "hidden md:table-cell" },
  { label: "Status", className: "" },
  { label: "Publish date", className: "hidden md:table-cell" },
  { label: "Updated", className: "hidden sm:table-cell" },
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
  const categoriesQuery = useLiveQuery({
    // The changelog list re-renders on every search/filter change; the
    // explicit keys keep the two list lookups off the identity path.
    queryKey: [
      "changelog-list-categories",
      changelogCategoryCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ category: changelogCategoryCollection })
        .where(({ category }) => eq(category.organizationId, organizationId)),
  });
  const categories = categoriesQuery.data ?? [];
  const categoryById = new Map(
    categories.map((category) => [category.id, category])
  );

  const linksQuery = useLiveQuery({
    queryKey: [
      "changelog-list-category-links",
      changelogCategoryLinkCollection.id,
      organizationId,
    ],
    query: (q) =>
      q
        .from({ link: changelogCategoryLinkCollection })
        .where(({ link }) => eq(link.organizationId, organizationId)),
  });
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
              <TableHead className={item.className} key={item.label}>
                <SkeletonWrapper>{item.label}</SkeletonWrapper>
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
                {/* The table cell default is `nowrap`; a long title would
                    otherwise force the table wider than a phone screen. */}
                <TableCell className="whitespace-normal">
                  <Link
                    params={{ organizationId, changelogSlug: changelog.slug }}
                    to="/$organizationId/changelog/edit/$changelogSlug"
                  >
                    {changelog.title}
                  </Link>
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {changelogCategories.length > 0 ? (
                    <span className="flex flex-wrap gap-1.5">
                      {changelogCategories.map((category) => (
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                          key={category.id}
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
                          {category.name}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {changelog.user.name ?? "Unknown"}
                </TableCell>
                <TableCell>
                  <ChangelogStatusBadge status={changelog.status} />
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  {formatPublishDate(
                    changelog.publishedAt,
                    changelog.scheduledAt
                  )}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  {formatDate(changelog.updatedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});
const publishDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(date: Date) {
  return mediumDateFormatter.format(date);
}

function formatPublishDate(publishedAt: Date | null, scheduledAt: Date | null) {
  const value = publishedAt ?? scheduledAt;

  if (!value) {
    return "Not scheduled";
  }

  return publishDateFormatter.format(value);
}
