import { useSortable } from "@dnd-kit/react/sortable";
import { SortableRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";

import type { BoardPostRow } from "./types";

interface BoardGridPostCardProps {
  /** The lane's id; a card is sortable within the lane it is rendered in. */
  groupId: string;
  organizationId: string;
  post: BoardPostRow;
  /**
   * The dnd-kit id. A label grouping can render the same post in more than one
   * lane, so the id carries the lane as well; a status lane keeps the post id
   * because the drop handler resolves the dragged post from it.
   */
  sortableId: string;
  index: number;
}

export const BoardGridPostCard = memo(function BoardGridPostCard({
  index,
  groupId,
  organizationId,
  post,
  sortableId,
}: BoardGridPostCardProps) {
  const navigate = useNavigate();
  const { isDragging, ref } = useSortable({
    id: sortableId,
    group: groupId,
    accept: "item",
    type: "item",
    index,
    data: { statusId: post.statusId },
  });

  return (
    <SortableRoadmapIssueCard
      isDragging={isDragging}
      onClick={() =>
        navigate({
          to: "/$organizationId/post/$boardSlug/$postSlug",
          params: {
            organizationId,
            boardSlug: post.boardSlug,
            postSlug: post.slug,
          },
        })
      }
      rootRef={ref}
      status={post.status}
      title={post.title}
      updatedAt={post.updatedAt}
    />
  );
});
