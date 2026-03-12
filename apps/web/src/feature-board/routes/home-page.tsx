import { eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { BoardListCard } from "../components/feedback/board-list-card";
import { FeedbackCard } from "../components/feedback/feedback-card";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
  FeedbackBrowseLayoutSidebar,
} from "../components/layout/feedback-browse-layout";
import { postCollection, publicBoardCollection } from "../lib/collections";
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
        .from({ post: postCollection })
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
        <p className="text-muted-foreground text-sm">Loading posts...</p>
      </MainContent>
    );
  }

  if (postsError) {
    return (
      <MainContent>
        <p className="text-muted-foreground text-sm">Loading posts...</p>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="grid gap-4">
        {postsWithBoards.map(({ post, board }) => (
          <FeedbackCard board={board} key={post.id} post={post} />
        ))}
      </div>
    </MainContent>
  );
}
