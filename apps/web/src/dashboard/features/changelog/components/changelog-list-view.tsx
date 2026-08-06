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
  categoryId: string | null;
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
  const { changelogCategoryCollection } = useDashboardCollections();
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
            const category = changelog.categoryId
              ? categoryById.get(changelog.categoryId)
              : undefined;

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
                  {category ? (
                    <span className="inline-flex items-center gap-2 text-sm">
                      <span
                        aria-hidden="true"
                        className="size-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: category.icon }}
                      />
                      <span>{category.name}</span>
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
