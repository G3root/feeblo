import type { ReactNode } from "react";
import { RoadmapLaneColumn } from "./roadmap-lane-column";
import type { RoadmapLane, RoadmapPost } from "./types";

interface RoadmapGridProps<TPost extends RoadmapPost> {
  emptyLaneMessage?: string;
  lanes: RoadmapLane<TPost>[];
  renderCard: (args: {
    columnIndex: number;
    lane: RoadmapLane<TPost>;
    post: TPost;
    postIndex: number;
  }) => ReactNode;
}

export function RoadmapGrid<TPost extends RoadmapPost>({
  emptyLaneMessage = "No issues yet.",
  lanes,
  renderCard,
}: RoadmapGridProps<TPost>) {
  return (
    <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3 pb-[max(calc(var(--spacing)*3),env(safe-area-inset-bottom))]">
      <div className="grid h-full min-h-0 min-w-max auto-cols-max grid-flow-col gap-4">
        {lanes.map((lane, columnIndex) => (
          <RoadmapLaneColumn
            key={lane.statusId}
            status={lane.status}
            totalPosts={lane.posts.length}
          >
            {lane.posts.length > 0 ? (
              lane.posts.map((post, postIndex) =>
                renderCard({
                  columnIndex,
                  lane,
                  post,
                  postIndex,
                })
              )
            ) : (
              <div className="rounded-md border border-dashed border-border/70 bg-background/40 px-3 py-6 text-center text-muted-foreground text-sm">
                {emptyLaneMessage}
              </div>
            )}
          </RoadmapLaneColumn>
        ))}
      </div>
    </div>
  );
}
