import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import { createFileRoute } from "@tanstack/react-router";

import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import {
  RoadmapDetailActions,
  RoadmapLoadingState,
  RoadmapEmptyState,
} from "~/features/roadmap/components/roadmap-detail-states";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap/$slug"
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
  const { organizationId, slug } = Route.useParams();

  const { isError, isLoading, lanesFor, roadmaps } = useRoadmapData({
    boardCollection,
    postCollection,
    postStatusCollection,
    roadmapCollection,
    roadmapColumnCollection,
    organizationId,
    slug,
  });

  if (isError) {
    throw new Error("Failed to load roadmap");
  }

  if (isLoading) {
    return <RoadmapLoadingState />;
  }

  if (roadmaps.length === 0) {
    return (
      <RoadmapEmptyState message="This roadmap does not exist or has been removed." />
    );
  }

  const roadmap = roadmaps[0];

  const lanes = lanesFor(roadmap.id);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <section className="flex h-full min-h-0 shrink-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-2 px-3">
          <div>
            <h1 className="text-xl font-semibold">{roadmap.name}</h1>
            {roadmap.description ? (
              <p className="text-muted-foreground mt-1 text-sm">
                {roadmap.description}
              </p>
            ) : null}
          </div>
          <RoadmapDetailActions
            roadmapId={roadmap.id}
            visibility={roadmap.visibility}
          />
        </header>
        {lanes.length > 0 ? (
          <RoadmapBoard lanes={lanes} organizationId={organizationId} />
        ) : (
          <RoadmapEmptyState message="This roadmap has no columns configured." />
        )}
      </section>
    </div>
  );
}
