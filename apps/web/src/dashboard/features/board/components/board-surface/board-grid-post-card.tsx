import { Feedback } from "@dnd-kit/dom";
import { useSortable } from "@dnd-kit/react/sortable";
import { useNavigate } from "@tanstack/react-router";
import { memo } from "react";
import { cn } from "~/lib/utils";
import type { BoardPostStatus } from "../../constants";
import { StatusIcon } from "./status-icon";
import type { BoardPostRow } from "./types";
import { formatPostDate } from "./utils";

interface BoardGridPostCardProps {
  boardSlug: string;
  column: string;
  id: string;
  index: number;
  organizationId: string;
  post: BoardPostRow;
}

export const BoardGridPostCard = memo(function BoardGridPostCard({
  id,
  index,
  column,
  organizationId,
  boardSlug,
  post,
}: BoardGridPostCardProps) {
  const navigate = useNavigate();
  const group = column;
  const { isDragging, ref } = useSortable({
    id,
    group,
    accept: "item",
    type: "item",
    plugins: [Feedback],
    index,
    data: { group },
    feedback: "clone",
  });

  return (
    // biome-ignore lint/a11y/noNoninteractiveElementInteractions: <explanation>
    // biome-ignore lint/a11y/noStaticElementInteractions: <explanation>
    // biome-ignore lint/a11y/useKeyWithClickEvents: <explanation>
    <div
      className={cn(
        "block rounded-md bg-background p-3 transition-all hover:border-muted-foreground/40 hover:bg-muted/20",
        isDragging && "opacity-60"
      )}
      onClick={() =>
        navigate({
          to: "/$organizationId/post/$boardSlug/$postSlug",
          params: {
            organizationId,
            boardSlug,
            postSlug: post.slug,
          },
        })
      }
      ref={ref}
    >
      <div className="flex justify-between gap-2">
        <span className="text-muted-foreground text-xs uppercase tracking-wide">
          {post.title}
        </span>
        <div className="flex items-start">
          <StatusIcon status={group as BoardPostStatus} />
        </div>
      </div>

      <div className="mt-3 text-muted-foreground text-xs">
        {formatPostDate(post.updatedAt)}
      </div>
    </div>
  );
});
