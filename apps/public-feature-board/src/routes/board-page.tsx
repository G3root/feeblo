import { PostCollectionDataProvider } from "@feeblo/post-ui/post-collection";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { BoardListCard } from "../components/feedback/board-list-card";
import {
  FeedbackCard,
  FeedbackCardSkeleton,
} from "../components/feedback/feedback-card";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
  FeedbackBrowseLayoutSidebar,
} from "../components/layout/feedback-browse-layout";
import { formatPostStatus } from "../lib/utils";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

function MainContent({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
        <FeedbackBrowseLayoutSidebar>
          <BoardListCard />
        </FeedbackBrowseLayoutSidebar>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

function ListHeader({ count, title }: { count?: number; title: string }) {
  return (
    <div className="flex items-baseline justify-between px-1 pb-3">
      <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      {count !== undefined && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {count} {count === 1 ? "post" : "posts"}
        </span>
      )}
    </div>
  );
}

export const Route = createLazyRoute("/b/$boardSlug")({
  component: BoardPage,
});

export function BoardPage() {
  const site = useSite();
  const organizationId = site.organizationId;
  const { boardSlug } = useParams({ from: "/b/$boardSlug" });
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
  } = usePublicCollections();

  const {
    data: board,
    isError: boardError,
    isLoading: boardLoading,
  } = useLiveQuery(
    (q) => {
      if (!(site.organizationId && boardSlug)) {
        return undefined;
      }

      return q
        .from({ board: publicBoardCollection })

        .where(({ board }) =>
          and(
            eq(board.organizationId, site.organizationId),
            eq(board.slug, boardSlug)
          )
        )
        .findOne();
    },
    [site.organizationId, boardSlug]
  );

  const {
    data: posts = [],
    isError: postsError,
    isLoading: postsLoading,
  } = useLiveQuery(
    (q) => {
      if (!board?.id) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .where(({ post }) =>
          and(
            eq(post.boardId, board?.id),
            eq(post.organizationId, site.organizationId)
          )
        )
        .select(({ post, postStatus }) => ({
          post: {
            ...post,
          },
          postStatus: {
            type: postStatus.type,
            label: postStatus.label,
            color: postStatus.color,
          },
        }));
    },
    [board?.id, site.organizationId]
  );

  if (boardLoading || (board && postsLoading)) {
    return (
      <MainContent>
        <div className="min-w-0">
          <ListHeader title="Loading..." />
          <div className="divide-border/40 border-border/60 w-full divide-y overflow-hidden rounded-lg border">
            {["a", "b", "c", "d", "e"].map((key) => (
              <FeedbackCardSkeleton key={key} />
            ))}
          </div>
        </div>
      </MainContent>
    );
  }

  if (boardError || postsError) {
    return (
      <MainContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Posts unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading this board.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainContent>
    );
  }

  if (!board) {
    return (
      <MainContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Board not found</EmptyTitle>
            <EmptyDescription>
              This public board does not exist anymore.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainContent>
    );
  }

  if (posts.length === 0) {
    return (
      <MainContent>
        <div className="min-w-0">
          <ListHeader count={0} title={board.name} />
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No feedback yet</EmptyTitle>
              <EmptyDescription>
                Posts from this board will appear here once shared publicly.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="min-w-0">
        <ListHeader count={posts.length} title={board.name} />
        <div className="divide-border/40 border-border/60 w-full divide-y overflow-hidden rounded-lg border">
          {posts.map(({ post, postStatus }) => (
            <PostCollectionDataProvider
              board={board}
              key={post.id}
              organizationId={organizationId}
              pageType="PublicPage"
              post={post}
            >
              <FeedbackCard
                color={postStatus.color ?? undefined}
                label={postStatus.label || formatPostStatus(postStatus.type)}
              />
            </PostCollectionDataProvider>
          ))}
        </div>
      </div>
    </MainContent>
  );
}
