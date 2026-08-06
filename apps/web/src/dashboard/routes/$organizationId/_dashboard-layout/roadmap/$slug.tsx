import { useRoadmapData } from "@feeblo/post-ui/roadmap/use-roadmap-data";
import { Button } from "@feeblo/ui/button";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import {
  CircleLockIcon,
  CircleUnlockIcon,
  Delete02Icon,
  Edit01Icon,
  Plus,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import {
  useCreateRoadmapDialogContext,
  useDeleteRoadmapDialogContext,
  useEditRoadmapDialogContext,
  useToggleRoadmapVisibilityDialogContext,
} from "~/features/roadmap/dialog-stores";
import { useOrganizationId } from "~/hooks/use-organization-id";
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
            <h1 className="font-semibold text-xl">{roadmap.name}</h1>
            {roadmap.description ? (
              <p className="mt-1 text-muted-foreground text-sm">
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

function RoadmapDetailActions({
  roadmapId,
  visibility,
}: {
  roadmapId: string;
  visibility: "public" | "private";
}) {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const deleteStore = useDeleteRoadmapDialogContext();
  const editStore = useEditRoadmapDialogContext();
  const visibilityStore = useToggleRoadmapVisibilityDialogContext();

  const isPrivate = visibility === "private";

  const handleDeleteClick = () => {
    deleteStore.send({ type: "toggle", data: { roadmapId } });
  };

  const handleEditClick = () => {
    editStore.send({ type: "toggle", data: { roadmapId } });
  };

  const handleVisibilityClick = () => {
    visibilityStore.send({
      type: "toggle",
      data: { roadmapId, currentVisibility: visibility },
    });
  };

  return (
    <PolicyGuard policy={hasPermission(organizationId, "roadmap.*")}>
      {({ allowed }) => (
        <div className="flex shrink-0 items-center gap-2">
          <Button
            disabled={!allowed}
            onClick={() => createStore.send({ type: "toggle" })}
            size="sm"
            variant="default"
          >
            <HugeiconsIcon icon={Plus} />
            New Roadmap
          </Button>
          <Button
            aria-label={
              isPrivate ? "Make roadmap public" : "Make roadmap private"
            }
            disabled={!allowed}
            onClick={handleVisibilityClick}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon
              icon={isPrivate ? CircleUnlockIcon : CircleLockIcon}
            />
            {isPrivate ? "Private" : "Public"}
          </Button>
          <Button
            aria-label="Edit roadmap"
            disabled={!allowed}
            onClick={handleEditClick}
            size="icon-sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Edit01Icon} />
          </Button>
          <Button
            aria-label="Delete roadmap"
            disabled={!allowed}
            onClick={handleDeleteClick}
            size="icon-sm"
            variant="destructive-outline"
          >
            <HugeiconsIcon icon={Delete02Icon} />
          </Button>
        </div>
      )}
    </PolicyGuard>
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

function RoadmapEmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}
