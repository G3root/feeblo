import { groupRoadmapPostsByStatus } from "@feeblo/post-ui/roadmap/utils";
import { Button } from "@feeblo/ui/button";
import { hasPermission, PolicyGuard } from "@feeblo/web-shared/use-policy";
import { Delete02Icon, Edit01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import {
  useCreateRoadmapDialogContext,
  useDeleteRoadmapDialogContext,
  useEditRoadmapDialogContext,
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

  const roadmapQuery = useLiveQuery(
    (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            eq(roadmap.slug, slug)
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
          slug: roadmap.slug,
        })),
    [organizationId, slug]
  );

  const columnsQuery = useLiveQuery(
    (q) =>
      q
        .from({ column: roadmapColumnCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ column, postStatus }) => eq(column.statusId, postStatus.id),
          "inner"
        )
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        )
        .select(({ column, postStatus }) => ({
          id: postStatus.id,
          name: column.name,
          roadmapId: column.roadmapId,
          type: postStatus.type,
        }))
        .orderBy(({ column }) => column.position, "asc"),
    [organizationId]
  );

  const postsQuery = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .join(
          { postStatus: postStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .join(
          { board: boardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "inner"
        )
        .where(({ board, post, postStatus }) =>
          and(
            eq(post.organizationId, organizationId),
            eq(postStatus.organizationId, organizationId),
            eq(board.organizationId, organizationId)
          )
        )
        .select(({ board, post, postStatus }) => ({
          boardName: board.name,
          boardSlug: board.slug,
          id: post.id,
          slug: post.slug,
          status: postStatus.type,
          statusId: post.statusId,
          summary: post.excerpt,
          title: post.title,
          updatedAt: post.updatedAt,
        }))
        .orderBy(({ post }) => post.createdAt, "desc"),
    [organizationId]
  );

  if (roadmapQuery.isError || columnsQuery.isError || postsQuery.isError) {
    throw new Error("Failed to load roadmap");
  }

  if (
    roadmapQuery.isLoading ||
    columnsQuery.isLoading ||
    postsQuery.isLoading
  ) {
    return <RoadmapLoadingState />;
  }

  const roadmaps = roadmapQuery.data ?? [];

  if (roadmaps.length === 0) {
    return (
      <RoadmapEmptyState message="This roadmap does not exist or has been removed." />
    );
  }

  const roadmap = roadmaps[0];
  const columns = columnsQuery.data ?? [];
  const posts = postsQuery.data ?? [];

  const roadmapColumns = columns.filter((col) => col.roadmapId === roadmap.id);

  const lanes = groupRoadmapPostsByStatus(posts, roadmapColumns);

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
          <RoadmapDetailActions roadmapId={roadmap.id} />
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

function RoadmapDetailActions({ roadmapId }: { roadmapId: string }) {
  const organizationId = useOrganizationId();
  const createStore = useCreateRoadmapDialogContext();
  const deleteStore = useDeleteRoadmapDialogContext();
  const editStore = useEditRoadmapDialogContext();

  const handleDeleteClick = () => {
    deleteStore.send({ type: "toggle", data: { roadmapId } });
  };

  const handleEditClick = () => {
    editStore.send({ type: "toggle", data: { roadmapId } });
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
