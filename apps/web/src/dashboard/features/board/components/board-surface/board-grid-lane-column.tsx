import { useDroppable } from "@dnd-kit/react";
import { cn } from "~/lib/utils";
import { BoardGridPostCard } from "./board-grid-post-card";
import { StatusIcon } from "./status-icon";
import type { BoardLane } from "./types";

export function BoardGridLaneColumn({
  lane,
  boardSlug,
  organizationId,
  laneMap,
}: {
  lane: BoardLane;
  boardSlug: string;
  organizationId: string;
  laneMap: Map<string, BoardLane>;
}) {
  const { ref, isDropTarget } = useDroppable({
    id: `lane:${lane.key}`,
    data: {
      laneKey: lane.key,
    },
  });

  return (
    <div className="flex h-96 w-80 flex-col overflow-hidden rounded-lg border border-border bg-muted/30">
      <div
        className="border-border border-b bg-linear-to-r px-3 py-2"
        style={{
          backgroundImage: `linear-gradient(to right, color-mix(in oklab, ${lane.toneVar} 18%, transparent), transparent)`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon status={lane.status} toneVar={lane.toneVar} />
            <h3 className="font-medium text-sm">{lane.label}</h3>
            <span className="text-muted-foreground text-xs">
              {lane.posts.length}
            </span>
          </div>
          <button
            aria-label={`Add post to ${lane.label}`}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground"
            type="button"
          >
            +
          </button>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 space-y-2 overflow-y-auto p-3 transition-colors",
          isDropTarget && "bg-muted/50"
        )}
        ref={ref}
      >
        {lane.posts.map((post) => (
          <BoardGridPostCard
            boardSlug={boardSlug}
            key={post.slug}
            lane={lane}
            laneMap={laneMap}
            organizationId={organizationId}
            post={post}
          />
        ))}
      </div>
    </div>
  );
}
