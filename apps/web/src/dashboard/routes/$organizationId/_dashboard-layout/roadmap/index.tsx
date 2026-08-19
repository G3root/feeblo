import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import { createFileRoute } from "@tanstack/react-router";

import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import {
  RoadmapListHeader,
  RoadmapLoadingState,
  RoadmapEmptyState,
  RoadmapEmptyMessage,
} from "~/features/roadmap/components/roadmap-list-states";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap/"
)({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      boardCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
      roadmapCollection.preload(),
      roadmapColumnCollection.preload(),
    ]);
    return null;
  },
});

function RouteComponent() {
  const { organizationId } = Route.useParams();

  const { isError, isLoading, lanesFor, roadmaps } = useRoadmapData({
    boardCollection,
    postCollection,
    postStatusCollection,
    roadmapCollection,
    roadmapColumnCollection,
    organizationId,
  });

  if (isError) {
    throw new Error("Failed to load roadmap");
  }

  if (isLoading) {
    return <RoadmapLoadingState />;
  }

  if (roadmaps.length === 0) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <RoadmapListHeader showCreateAction={false} />
        <RoadmapEmptyState />
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <RoadmapListHeader />
      {roadmaps.map((roadmap) => {
        const lanes = lanesFor(roadmap.id);

        return (
          <section
            className="flex h-full min-h-0 shrink-0 flex-col gap-4"
            key={roadmap.id}
          >
            <header className="px-3">
              <h1 className="text-xl font-semibold">{roadmap.name}</h1>
              {roadmap.description ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  {roadmap.description}
                </p>
              ) : null}
            </header>
            {lanes.length > 0 ? (
              <RoadmapBoard lanes={lanes} organizationId={organizationId} />
            ) : (
              <RoadmapEmptyMessage message="This roadmap has no columns configured." />
            )}
          </section>
        );
      })}
    </div>
  );
}
