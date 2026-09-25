import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import {
  Accordion,
  AccordionItem,
  AccordionPanel,
  AccordionTrigger,
} from "@feeblo/ui/accordion";
import { Badge } from "@feeblo/ui/badge";
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

/**
 * Collapsible list of the posts merged into the viewed survivor, mirroring
 * the public changelog's linked-posts list. Merged posts are hidden from
 * boards and their own pages are read-only until unmerged, so this is the
 * moderator's way back into a duplicate's discussion. Rendered on the
 * dashboard only: public surfaces do not expose merged posts.
 */
export function PostMergedPosts() {
  const { organizationId, post } = usePostCollectionData();
  const { boardCollection, postCollection, postStatusCollection } =
    useDashboardCollections();

  const { data: mergedPosts } = useLiveQuery({
    query: (query) =>
      query
        .from({ post: postCollection })
        .join(
          { board: boardCollection },
          ({ board: candidateBoard, post: candidate }) =>
            eq(candidate.boardId, candidateBoard.id),
          "inner"
        )
        .join(
          { status: postStatusCollection },
          ({ post: candidate, status: candidateStatus }) =>
            eq(candidate.statusId, candidateStatus.id),
          "inner"
        )
        .where(({ post: candidate }) =>
          and(
            eq(candidate.organizationId, organizationId),
            eq(candidate.mergedIntoPostId, post.id)
          )
        )
        .orderBy(({ post: candidate }) => candidate.mergedAt, "desc")
        .select(({ board: candidateBoard, post: candidate, status }) => ({
          boardSlug: candidateBoard.slug,
          id: candidate.id,
          slug: candidate.slug,
          statusLabel: status.label,
          statusType: status.type,
          title: candidate.title,
        })),
  });

  if (!mergedPosts || mergedPosts.length === 0) {
    return null;
  }

  return (
    <Accordion className="rounded-xl border px-4">
      <AccordionItem value="merged-posts">
        <AccordionTrigger>
          <span className="flex items-center gap-2">
            Merged posts
            <Badge size="sm" variant="secondary">
              {mergedPosts.length}
            </Badge>
          </span>
        </AccordionTrigger>
        <AccordionPanel>
          <div className="divide-y rounded-xl border">
            {mergedPosts.map((mergedPost) => (
              <Link
                className="hover:bg-muted/40 flex items-center justify-between gap-4 px-4 py-3 transition-colors"
                key={mergedPost.id}
                params={{
                  boardSlug: mergedPost.boardSlug,
                  organizationId,
                  postSlug: mergedPost.slug,
                }}
                to="/$organizationId/post/$boardSlug/$postSlug"
              >
                <span className="min-w-0 truncate text-sm font-medium">
                  {mergedPost.title}
                </span>
                <span className="text-muted-foreground shrink-0 text-xs">
                  {mergedPost.statusLabel ||
                    formatPostStatus(mergedPost.statusType)}
                </span>
              </Link>
            ))}
          </div>
        </AccordionPanel>
      </AccordionItem>
    </Accordion>
  );
}
