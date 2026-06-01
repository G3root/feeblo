import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useBoardPostsData } from "~/features/board/components/board-surface/use-board-posts-data";
import {
  groupRoadmapPostsByStatus,
  PublicRoadmapIssueCard,
  RoadmapGrid,
} from "~/features/roadmap/components";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/roadmap"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { organizationId } = Route.useParams();
  const navigate = useNavigate();
  const { hasError, isLoading, postStatuses, posts } = useBoardPostsData({
    organizationId,
    postStatusFilter: "all",
    search: "",
    statusOperator: "isAnyOf",
    statuses: ["PLANNED", "IN_PROGRESS", "COMPLETED"],
    tagIds: [],
    tagOperator: "includeAllOf",
  });

  if (hasError) {
    throw new Error("Failed to load roadmap");
  }

  const roadmapStatuses = postStatuses.filter(
    (status) =>
      status.type === "PLANNED" ||
      status.type === "IN_PROGRESS" ||
      status.type === "COMPLETED"
  );
  const roadmapPosts = posts.filter(
    (post) =>
      post.status === "PLANNED" ||
      post.status === "IN_PROGRESS" ||
      post.status === "COMPLETED"
  );
  const groupedPosts = groupRoadmapPostsByStatus(roadmapPosts, roadmapStatuses);

  if (isLoading) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden p-4 md:p-6">
        <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
          {["planned", "progress", "completed"].map((key) => (
            <div className="h-96 w-80 rounded-lg bg-muted/30" key={key} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-hidden p-4 md:p-6">
      <RoadmapGrid
        emptyLaneMessage="No issues in this stage."
        lanes={groupedPosts}
        renderCard={({ post }) => (
          <PublicRoadmapIssueCard
            boardName={post.boardName}
            key={post.id}
            onClick={() =>
              navigate({
                to: "/$organizationId/post/$boardSlug/$postSlug",
                params: {
                  boardSlug: post.boardSlug,
                  organizationId,
                  postSlug: post.slug,
                },
              })
            }
            status={post.status}
            title={post.title}
            updatedAt={post.updatedAt}
          />
        )}
      />
    </div>
  );
}
