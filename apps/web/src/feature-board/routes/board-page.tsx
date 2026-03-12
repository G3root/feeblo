import { and, eq, useLiveQuery } from "@tanstack/react-db";
import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
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
        .from({ post: postCollection })
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
        <p className="text-muted-foreground text-sm">Loading posts...</p>
      </MainContent>
    );
  }

  if (boardError || postsError) {
    return (
      <MainContent>
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle>Posts unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            There was a problem loading this board.
          </CardContent>
        </Card>
      </MainContent>
    );
  }

  if (!board) {
    return (
      <MainContent>
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle>Board not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            This public board does not exist anymore.
          </CardContent>
        </Card>
      </MainContent>
    );
  }

  if (posts.length === 0) {
    return (
      <Empty className="border border-border/70 border-dashed bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>No posts yet</EmptyTitle>
          <EmptyDescription>
            New updates and requests for this board will appear here once they
            are shared publicly.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <MainContent>
      <div className="grid gap-4">
        {posts.map((post) => (
          <FeedbackCard board={board} key={post.id} post={post} />
        ))}
      </div>
    </MainContent>
  );
}
