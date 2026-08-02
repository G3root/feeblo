import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { hasOwnerOrAdminRole, usePolicy } from "@feeblo/web-shared/use-policy";
import { LayoutThreeColumnIcon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import { useCreateRoadmapDialogContext } from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
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
        <RoadmapListHeader />
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
              <h1 className="font-semibold text-xl">{roadmap.name}</h1>
              {roadmap.description ? (
                <p className="mt-1 text-muted-foreground text-sm">
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

function RoadmapListHeader() {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const { allowed: canManage } = usePolicy(hasOwnerOrAdminRole(organizationId));

  return (
    <div className="flex items-center justify-between px-3">
      <h1 className="font-semibold text-xl">Roadmaps</h1>
      {canManage && (
        <Button onClick={() => createStore.send({ type: "toggle" })} size="sm">
          <HugeiconsIcon icon={Plus} />
          New Roadmap
        </Button>
      )}
    </div>
  );
}

function RoadmapLoadingState() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden p-4 md:p-6">
      <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
        {["planned", "in-progress", "completed"].map((key) => (
          <div className="h-96 w-80 rounded-lg bg-muted/30" key={key} />
        ))}
      </div>
    </div>
  );
}

function RoadmapEmptyState() {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const { allowed: canManage } = usePolicy(hasOwnerOrAdminRole(organizationId));

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={LayoutThreeColumnIcon} />
        </EmptyMedia>
        <EmptyTitle>No roadmaps yet</EmptyTitle>
        <EmptyDescription>
          Create a roadmap to visualize how feedback moves from idea to shipped.
        </EmptyDescription>
      </EmptyHeader>
      {canManage ? (
        <EmptyContent>
          <Button onClick={() => createStore.send({ type: "toggle" })}>
            <HugeiconsIcon icon={Plus} />
            Create roadmap
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function RoadmapEmptyMessage({ message }: { message: string }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>Nothing here yet</EmptyTitle>
        <EmptyDescription>{message}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
