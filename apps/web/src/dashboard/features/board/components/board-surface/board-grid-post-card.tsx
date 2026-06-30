import { useSortable } from "@dnd-kit/react/sortable";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";
import { SortableRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import type { BoardPostRow } from "./types";

interface BoardGridPostCardProps {
  column: string;
  id: string;
  index: number;
  organizationId: string;
  post: BoardPostRow;
  statusId: string;
}

export const BoardGridPostCard = memo(function BoardGridPostCard({
  id,
  index,
  column,
  organizationId,
  post,
  statusId,
}: BoardGridPostCardProps) {
  const navigate = useNavigate();
  const group = column;
  const { isDragging, ref } = useSortable({
    id,
    group,
    accept: "item",
    type: "item",
    index,
    data: { column, statusId },
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
      status={group as BoardPostStatus}
      title={post.title}
      updatedAt={post.updatedAt}
    />
  );
});
