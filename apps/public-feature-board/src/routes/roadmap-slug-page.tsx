import { RoadmapGrid } from "@feeblo/post-ui/roadmap/roadmap-grid";
import { PublicRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { groupRoadmapPostsByStatus } from "@feeblo/post-ui/roadmap/utils";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import {
  createLazyRoute,
  getRouteApi,
  useNavigate,
} from "@tanstack/react-router";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

const roadmapSlugRouteApi = getRouteApi("/roadmap/$slug");

export const Route = createLazyRoute("/roadmap/$slug")({
  component: RoadmapSlugPage,
});

function RoadmapSlugPage() {
  const site = useSite();
  const navigate = useNavigate();
  const { slug } = roadmapSlugRouteApi.useParams();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicRoadmapCollection,
    publicRoadmapColumnCollection,
  } = usePublicCollections();

  const roadmapsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ roadmap: publicRoadmapCollection })
        .where(({ roadmap }) =>
          and(
            eq(roadmap.organizationId, site.organizationId),
            eq(roadmap.mode, "status")
          )
        )
        .select(({ roadmap }) => ({
          description: roadmap.description,
          id: roadmap.id,
          name: roadmap.name,
          slug: roadmap.slug,
        }))
        .orderBy(({ roadmap }) => roadmap.createdAt, "asc");
    },
    [site.organizationId]
  );

  const columnsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ column: publicRoadmapColumnCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ column, postStatus }) => eq(column.statusId, postStatus.id),
          "inner"
        )
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, site.organizationId)
        )
        .select(({ column, postStatus }) => ({
          id: postStatus.id,
          name: column.name,
          roadmapId: column.roadmapId,
          type: postStatus.type,
        }))
        .orderBy(({ column }) => column.position, "asc");
    },
    [site.organizationId]
  );

  const postsQuery = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "inner"
        )
        .where(({ board, post, postStatus }) =>
          and(
            eq(post.organizationId, site.organizationId),
            eq(postStatus.organizationId, site.organizationId),
            eq(board.organizationId, site.organizationId)
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
        .orderBy(({ post }) => post.createdAt, "desc");
    },
    [site.organizationId]
  );

  if (roadmapsQuery.isError || columnsQuery.isError || postsQuery.isError) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          There was a problem loading the roadmap.
        </div>
      </div>
    );
  }

  if (
    roadmapsQuery.isLoading ||
    columnsQuery.isLoading ||
    postsQuery.isLoading
  ) {
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

  const roadmaps = roadmapsQuery.data ?? [];
  const primaryRoadmap = roadmaps[0];
  const selectedRoadmap = roadmaps.find((r) => r.slug === slug);

  if (!selectedRoadmap) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
        <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
          This roadmap does not exist or has been removed.
        </div>
      </div>
    );
  }

  const columns = columnsQuery.data ?? [];
  const posts = postsQuery.data ?? [];
  const lanes = groupRoadmapPostsByStatus(
    posts,
    columns.filter((column) => column.roadmapId === selectedRoadmap.id)
  );

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      <section className="flex h-full min-h-0 shrink-0 flex-col gap-4">
        <header className="flex items-start justify-between gap-2 px-3">
          <div>
            <h1 className="font-semibold text-xl">{selectedRoadmap.name}</h1>
            {selectedRoadmap.description ? (
              <p className="mt-1 text-muted-foreground text-sm">
                {selectedRoadmap.description}
              </p>
            ) : null}
          </div>
          <Select
            onValueChange={(newSlug) => {
              if (newSlug === null) return;
              if (primaryRoadmap && newSlug === primaryRoadmap.slug) {
                navigate({
                  to: "/roadmap",
                  replace: true,
                });
              } else {
                navigate({
                  to: "/roadmap/$slug",
                  params: { slug: newSlug },
                  replace: true,
                });
              }
            }}
            value={selectedRoadmap.slug}
          >
            <SelectTrigger className="min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {roadmaps.map((roadmap) => (
                <SelectItem key={roadmap.id} value={roadmap.slug}>
                  {roadmap.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </header>
        {lanes.length > 0 ? (
          <RoadmapGrid
            emptyLaneMessage="No updates in this stage."
            lanes={lanes}
            renderCard={({ post }) => (
              <PublicRoadmapIssueCard
                boardName={post.boardName}
                key={post.id}
                onClick={() => navigate({ to: `/p/${post.slug}` })}
                status={post.status}
                title={post.title}
                updatedAt={post.updatedAt}
              />
            )}
          />
        ) : (
          <div className="flex min-h-64 flex-1 items-center justify-center rounded-lg border border-border/70 border-dashed bg-muted/20 p-6 text-center text-muted-foreground text-sm">
            This roadmap has no columns configured.
          </div>
        )}
      </section>
    </div>
  );
}
