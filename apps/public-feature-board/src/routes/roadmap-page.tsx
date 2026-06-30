import {
  groupRoadmapPostsByStatus,
  PublicRoadmapIssueCard,
  RoadmapGrid,
} from "@feeblo/post-ui/roadmap";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../components/layout/feedback-browse-layout";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

function MainLayout({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            {children}
          </div>
        </FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

export const Route = createLazyRoute("/roadmap")({
  component: RoadmapPage,
});

function RoadmapPage() {
  const site = useSite();
  const navigate = useNavigate();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
  } = usePublicCollections();

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
          summary: post.excerpt,
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
      <MainLayout>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Roadmap unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading the roadmap.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <h2 className="px-3 pb-3 font-semibold text-base tracking-tight">
        RoadMap
      </h2>

      {statusLoading || boardLoading || postLoading ? (
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3">
          <div className="grid h-full min-w-max auto-cols-max grid-flow-col gap-4">
            {["planned", "progress", "completed"].map((key) => (
              <div className="h-full w-80 rounded-lg bg-muted/30" key={key} />
            ))}
          </div>
        </div>
      ) : (
        <RoadmapGrid
          emptyLaneMessage="No updates in this stage."
          lanes={groupedPosts}
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
      )}
    </MainLayout>
  );
}
