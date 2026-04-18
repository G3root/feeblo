import { eq, useLiveQuery } from "@tanstack/react-db";
import { useLocation } from "wouter";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import {
  groupRoadmapPostsByStatus,
  PublicRoadmapIssueCard,
  RoadmapGrid,
} from "../../dashboard/features/roadmap/components";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../components/layout/feedback-browse-layout";
import {
  publicBoardCollection,
  publicPostCollection,
  publicPostStatusCollection,
} from "../lib/collections";
import { useSite } from "../providers/site-provider";

export function RoadmapPage() {
  const site = useSite();
  const [, navigate] = useLocation();

  const {
    data: statuses = [],
    isError: statusError,
    isLoading: statusLoading,
  } = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ status: publicPostStatusCollection })
        .where(({ status }) => eq(status.organizationId, site.organizationId))
        .select(({ status }) => ({
          id: status.id,
          type: status.type,
        }));
    },
    [site.organizationId]
  );

  const {
    data: boards = [],
    isError: boardError,
    isLoading: boardLoading,
  } = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId))
        .select(({ board }) => ({
          id: board.id,
          name: board.name,
        }));
    },
    [site.organizationId]
  );

  const {
    data: posts = [],
    isError: postError,
    isLoading: postLoading,
  } = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId))
        .select(({ post }) => ({
          boardId: post.boardId,
          id: post.id,
          slug: post.slug,
          statusId: post.statusId,
          summary: post.content,
          title: post.title,
          updatedAt: post.updatedAt,
        }));
    },
    [site.organizationId]
  );

  const roadmapStatuses = statuses.filter(
    (status) =>
      status.type === "PLANNED" ||
      status.type === "IN_PROGRESS" ||
      status.type === "COMPLETED"
  );
  const roadmapStatusById = new Map(
    roadmapStatuses.map((status) => [status.id, status.type])
  );
  const boardNameById = new Map(boards.map((board) => [board.id, board.name]));
  const roadmapPosts = posts.flatMap((post) => {
    const status = roadmapStatusById.get(post.statusId);

    if (!status) {
      return [];
    }

    return [
      {
        ...post,
        boardName: boardNameById.get(post.boardId) ?? "General",
        status,
      },
    ];
  });
  const groupedPosts = groupRoadmapPostsByStatus(roadmapPosts, roadmapStatuses);

  if (statusError || boardError || postError) {
    return (
      <FeedbackBrowseLayout>
        <FeedbackBrowseLayoutContent fullWidth>
          <FeedbackBrowseLayoutMain>
            <Empty className="border">
              <EmptyHeader>
                <EmptyTitle>Roadmap unavailable</EmptyTitle>
                <EmptyDescription>
                  There was a problem loading the roadmap.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          </FeedbackBrowseLayoutMain>
        </FeedbackBrowseLayoutContent>
      </FeedbackBrowseLayout>
    );
  }

  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>
          <h2 className="px-3 pb-3 font-semibold text-base tracking-tight">
            RoadMap
          </h2>

          {statusLoading || boardLoading || postLoading ? (
            <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
              {["planned", "progress", "completed"].map((key) => (
                <div className="h-96 w-80 rounded-lg bg-muted/30" key={key} />
              ))}
            </div>
          ) : (
            <RoadmapGrid
              emptyLaneMessage="No updates in this stage."
              lanes={groupedPosts}
              renderCard={({ post }) => (
                <PublicRoadmapIssueCard
                  boardName={post.boardName}
                  key={post.id}
                  onClick={() => navigate(`/p/${post.slug}`)}
                  status={post.status}
                  title={post.title}
                  updatedAt={post.updatedAt}
                />
              )}
            />
          )}
        </FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}
