/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { BoardListCard } from "../components/feedback/board-list-card";
import { FeedbackCard } from "../components/feedback/feedback-card";
import { postCollection, publicBoardCollection } from "../lib/collections";
import { useSite } from "../providers/site-provider";

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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-6">
          {postsLoading ? (
            <p className="text-muted-foreground text-sm">Loading posts...</p>
          ) : postsError ? (
            <Card className="ring-1 ring-border/60">
              <CardHeader>
                <CardTitle>Posts unavailable</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                There was a problem loading the public board.
              </CardContent>
            </Card>
          ) : postsWithBoards.length === 0 ? (
            <Empty className="border border-border/70 border-dashed bg-muted/20">
              <EmptyHeader>
                <EmptyTitle>No posts yet</EmptyTitle>
                <EmptyDescription>
                  New updates and requests will appear here once they are shared
                  publicly.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4">
              {postsWithBoards.map(({ post, board }) => (
                <FeedbackCard board={board} key={post.id} post={post} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <BoardListCard />
        </aside>
      </div>
    </div>
  );
}
