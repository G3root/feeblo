import { and, eq, useLiveQuery } from "@tanstack/react-db";
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
import {
  publicBoardCollection,
  publicPostCollection,
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

export function BoardPage({ boardSlug }: { boardSlug: string }) {
  const site = useSite();

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
        .where(({ post }) =>
          and(
            eq(post.boardId, board?.id),
            eq(post.organizationId, site.organizationId)
          )
        );
    },
    [board?.id, site.organizationId]
  );

  if (boardLoading || (board && postsLoading)) {
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

  if (boardError || postsError) {
    return (
      <MainContent>
        <div className="min-w-0 rounded-lg border border-border/60 p-12 text-center">
          <p className="font-medium text-sm">Posts unavailable</p>
          <p className="mt-1 text-muted-foreground text-xs">
            There was a problem loading this board.
          </p>
        </div>
      </MainContent>
    );
  }

  if (!board) {
    return (
      <MainContent>
        <div className="min-w-0 rounded-lg border border-border/60 p-12 text-center">
          <p className="font-medium text-sm">Board not found</p>
          <p className="mt-1 text-muted-foreground text-xs">
            This public board does not exist anymore.
          </p>
        </div>
      </MainContent>
    );
  }

  if (posts.length === 0) {
    return (
      <MainContent>
        <div className="min-w-0">
          <ListHeader count={0} title={board.name} />
          <div className="w-full rounded-lg border border-border/70 border-dashed p-12 text-center">
            <p className="font-medium text-foreground/80 text-sm">
              No posts yet
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              New updates and requests for this board will appear here.
            </p>
          </div>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="min-w-0">
        <ListHeader count={posts.length} title={board.name} />
        <div className="w-full divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
          {posts.map((post) => (
            <FeedbackCard board={board} key={post.id} post={post} />
          ))}
        </div>
      </div>
    </MainContent>
  );
}
