import { eq, useLiveQuery } from "@tanstack/react-db";
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

export function HomePage() {
  const site = useSite();

  const {
    data: postsWithBoards = [],
    isError: postsError,
    isLoading: postsLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ post: publicPostCollection })
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "inner"
        )
        .where(({ post }) => eq(post.organizationId, site.organizationId)),
    [site.organizationId]
  );

  if (postsLoading) {
    return (
      <MainContent>
        <div className="min-w-0">
          <div className="flex items-baseline justify-between px-1 pb-3">
            <h2 className="font-semibold text-base tracking-tight">
              All feedback
            </h2>
          </div>
          <div className="w-full divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
            {["a", "b", "c", "d", "e"].map((key) => (
              <FeedbackCardSkeleton key={key} />
            ))}
          </div>
        </div>
      </MainContent>
    );
  }

  if (postsError) {
    return (
      <MainContent>
        <div className="min-w-0 rounded-lg border border-border/60 p-12 text-center">
          <p className="font-medium text-sm">Feedback unavailable</p>
          <p className="mt-1 text-muted-foreground text-xs">
            There was a problem loading feedback.
          </p>
        </div>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="min-w-0">
        <div className="flex items-baseline justify-between px-1 pb-3">
          <h2 className="font-semibold text-base tracking-tight">
            All feedback
          </h2>
          {postsWithBoards.length > 0 && (
            <span className="text-muted-foreground text-xs tabular-nums">
              {postsWithBoards.length}{" "}
              {postsWithBoards.length === 1 ? "post" : "posts"}
            </span>
          )}
        </div>
        {postsWithBoards.length === 0 ? (
          <div className="w-full rounded-lg border border-border/70 border-dashed p-12 text-center">
            <p className="font-medium text-foreground/80 text-sm">
              No feedback yet
            </p>
            <p className="mt-1 text-muted-foreground text-xs">
              Posts from all boards will appear here once shared publicly.
            </p>
          </div>
        ) : (
          <div className="w-full divide-y divide-border/40 overflow-hidden rounded-lg border border-border/60">
            {postsWithBoards.map(({ post, board }) => (
              <FeedbackCard board={board} key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </MainContent>
  );
}
