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
    <section className="overflow-x-auto pb-3">
      <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 p-3">
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
    </section>
  );
}
