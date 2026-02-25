import { useDraggable } from "@dnd-kit/react";
import { Link } from "@tanstack/react-router";
import { cn } from "~/lib/utils";
import { StatusIcon } from "./status-icon";
import type { BoardLane, BoardPostRow } from "./types";
import { formatPostDate } from "./utils";

export function BoardGridPostCard({
  post,
  lane,
  boardSlug,
  organizationId,
  laneMap,
}: {
  post: BoardPostRow;
  lane: BoardLane;
  boardSlug: string;
  organizationId: string;
  laneMap: Map<string, BoardLane>;
}) {
  const { ref, isDragging } = useDraggable({
    id: `post:${post.slug}`,
    data: {
      laneKey: lane.key,
      status: post.status,
    },
  });

  const laneTone = laneMap.get(lane.key)?.toneVar ?? lane.toneVar;

  return (
    <Link
      className={cn(
        "block rounded-md border border-border bg-background p-3 transition-all hover:border-muted-foreground/40 hover:bg-muted/20",
        isDragging && "opacity-60"
      )}
      params={{
        organizationId,
        boardSlug,
        postSlug: post.slug,
      }}
      ref={ref as (element: HTMLAnchorElement | null) => void}
      to="/$organizationId/board/$boardSlug/$postSlug"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-muted-foreground text-xs uppercase tracking-wide">
          {post.slug}
        </span>
        <StatusIcon status={post.status} toneVar={laneTone} />
      </div>
      <p className="mt-2 line-clamp-2 font-semibold text-sm leading-6">
        {post.title}
      </p>
      <p className="mt-2 line-clamp-2 text-muted-foreground text-xs">
        {post.summary}
      </p>
      <div className="mt-3 text-muted-foreground text-xs">
        {formatPostDate(post.updatedAt)}
      </div>
    </Link>
  );
}
