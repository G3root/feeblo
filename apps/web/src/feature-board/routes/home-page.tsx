import { and, eq, toArray, useLiveQuery } from "@tanstack/react-db";

import type { ReactNode } from "react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
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
import {
  publicBoardCollection,
  publicPostCollection,
  publicPostStatusCollection,
} from "../lib/collections";
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
      <h2 className="font-semibold text-base tracking-tight">{title}</h2>
      {count !== undefined && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {count} {count === 1 ? "post" : "posts"}
        </span>
      )}
    </div>
  );
}

export function HomePage() {
  const site = useSite();

  ///used here for prefecthing cache for when user visits a board page, which also needs post statuses
  const { isError: statusError, isLoading: statusLoading } = useLiveQuery(
    (q) =>
      q
        .from({ status: publicPostStatusCollection })
        .where(({ status }) => eq(status.organizationId, site.organizationId)),
    [site.organizationId]
  );

  // used here for prefetching cache for when user visits a board page, which also needs boards

  const { isError: boardError, isLoading: boardLoading } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
    [site.organizationId]
  );

  const {
    data: postsWithBoards = [],
    isError: postsError,
    isLoading: postsLoading,
  } = useLiveQuery(
    (q) => {
      if (
        !site.organizationId ||
        statusLoading ||
        boardLoading ||
        statusError ||
        boardError
      ) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId))

        .select(({ post }) => ({
          id: post.id,
          slug: post.slug,
          title: post.title,
          content: post.content,
          upVotes: post.upVotes,
          hasUserUpVoted: post.hasUserUpVoted,
          creatorId: post.creatorId,
          user: post.user,

          board: toArray(
            q
              .from({ board: publicBoardCollection })
              .where(({ board }) =>
                and(
                  eq(board.id, post.boardId),
                  eq(board.organizationId, post.organizationId)
                )
              )
          ),
          status: toArray(
            q
              .from({ status: publicPostStatusCollection })
              .where(({ status }) =>
                and(
                  eq(status.id, post.statusId),
                  eq(status.organizationId, post.organizationId)
                )
              )
          ),
        }));
    },
    [site.organizationId, statusLoading, boardLoading, statusError, boardError]
  );

  if (statusLoading || boardLoading || postsLoading) {
    return (
      <MainContent>
        <div className="min-w-0">
          <ListHeader title="Loading..." />
          <div className="w-full divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
            {["a", "b", "c", "d", "e"].map((key) => (
              <FeedbackCardSkeleton key={key} />
            ))}
          </div>
        </div>
      </MainContent>
    );
  }

  if (statusError || boardError || postsError) {
    return (
      <MainContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Feedback unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading feedback.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainContent>
    );
  }

  if (postsWithBoards.length === 0) {
    return (
      <MainContent>
        <div className="min-w-0">
          <ListHeader count={0} title="All feedback" />
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No feedback yet</EmptyTitle>
              <EmptyDescription>
                Posts from all boards will appear here once shared publicly.
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
        <ListHeader count={postsWithBoards.length} title="All feedback" />
        <div className="w-full divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
          {postsWithBoards.map((post) => {
            const board = post.board[0];
            const status = post.status[0];

            if (!(board && status)) {
              return null;
            }

            return (
              <FeedbackCard
                board={board}
                key={post.id}
                post={post}
                status={status.type}
              />
            );
          })}
        </div>
      </div>
    </MainContent>
  );
}
