import type { THelpCenterArticleSummary } from "@feeblo/domain/help-center-article/schema";
import { SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { Link } from "@tanstack/react-router";

import { HelpCenterArticleStatusBadge } from "./help-center-article-status";

const mediumDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

// Narrow screens keep the title and status — the two columns that answer
// "what is it" and "where is it" — and drop the rest. The table can still
// scroll horizontally, but six columns on a phone leaves every cell clipped.
const headItems = [
  { className: "", label: "Title" },
  { className: "", label: "Status" },
  { className: "hidden sm:table-cell", label: "Views" },
  { className: "hidden md:table-cell", label: "Helpful" },
  { className: "hidden md:table-cell", label: "Published" },
  { className: "hidden sm:table-cell", label: "Updated" },
];

/**
 * The articles of one section, in the same table the changelog list uses.
 *
 * The counters are on the row already — the server derives them per article —
 * so a list of fifty articles is one read, not one per row.
 */
export function HelpCenterArticleListView({
  articles,
  organizationId,
}: {
  articles: ReadonlyArray<THelpCenterArticleSummary>;
  organizationId: string;
}) {
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
          {articles.map((article) => (
            <TableRow key={article.id}>
              {/* The table cell default is `nowrap`; a long title would
                  otherwise force the table wider than a phone screen. */}
              <TableCell className="whitespace-normal">
                <Link
                  params={{ articleId: article.id, organizationId }}
                  to="/$organizationId/help-center/article/$articleId"
                >
                  {article.title}
                </Link>
              </TableCell>
              <TableCell>
                <HelpCenterArticleStatusBadge status={article.status} />
              </TableCell>
              <TableCell className="hidden tabular-nums sm:table-cell">
                {article.viewCount.toLocaleString()}
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">
                {formatHelpfulShare(article)}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {formatDate(article.publishedAt)}
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                {formatDate(article.updatedAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function formatDate(date: Date | null) {
  return date === null ? "—" : mediumDateFormatter.format(date);
}

/** A share of the verdicts cast, or a dash when nobody voted. */
function formatHelpfulShare(article: THelpCenterArticleSummary): string {
  const votes = article.helpfulCount + article.notHelpfulCount;

  if (votes === 0) {
    return "—";
  }

  return `${Math.round((article.helpfulCount / votes) * 100)}%`;
}
