import { Link } from "@tanstack/react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
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

export function ChangelogListView({
  changelogs,
  organizationId,
}: {
  changelogs: TChangelogListItem[];
  organizationId: string;
}) {
  return (
    <div className="p-3">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Author</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Publish date</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {changelogs.map((changelog) => (
            <TableRow key={changelog.id}>
              <TableCell>
                <Link
                  params={{ organizationId, changelogSlug: changelog.slug }}
                  to="/$organizationId/changelog/edit/$changelogSlug"
                >
                  {changelog.title}
                </Link>
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
          ))}
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
