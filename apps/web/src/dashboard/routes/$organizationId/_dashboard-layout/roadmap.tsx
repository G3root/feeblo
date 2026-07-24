import { groupRoadmapPostsByStatus } from "@feeblo/post-ui/roadmap/utils";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { RoadmapBoard } from "~/features/roadmap/components/roadmap-board";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
  roadmapCollection,
  roadmapColumnCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap"
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

  const roadmapsQuery = useLiveQuery(
    (q) =>
      q
        .from({ roadmap: roadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, organizationId),
            eq(roadmap.mode, "status")
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
        }))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc"),
    [organizationId]
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

  if (roadmapsQuery.isError || columnsQuery.isError || postsQuery.isError) {
    throw new Error("Failed to load roadmap");
  }

  if (
    roadmapsQuery.isLoading ||
    columnsQuery.isLoading ||
    postsQuery.isLoading
  ) {
    return <RoadmapLoadingState />;
  }

  const roadmaps = roadmapsQuery.data ?? [];

  if (roadmaps.length === 0) {
    return (
      <RoadmapEmptyState message="This workspace does not have a roadmap yet." />
    );
  }

  const columns = columnsQuery.data ?? [];
  const posts = postsQuery.data ?? [];

  const columnsByRoadmapId = new Map<string, typeof columns>();
  for (const column of columns) {
    const grouped = columnsByRoadmapId.get(column.roadmapId);
    if (grouped) {
      grouped.push(column);
    } else {
      columnsByRoadmapId.set(column.roadmapId, [column]);
    }
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {roadmaps.map((roadmap) => {
        const lanes = groupRoadmapPostsByStatus(
          posts,
          columnsByRoadmapId.get(roadmap.id) ?? []
        );

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
              <RoadmapEmptyState message="This roadmap has no columns configured." />
            )}
          </section>
        );
      })}
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

function RoadmapEmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
      {message}
    </div>
  );
}
