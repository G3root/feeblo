import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { BoardListCard } from "../components/feedback/board-list-card";
import { FeedbackCard } from "../components/feedback/feedback-card";
import { postCollection, publicBoardCollection } from "../lib/collections";
import { useSite } from "../providers/site-provider";

export function BoardPage({ boardSlug }: { boardSlug: string }) {
  const site = useSite();

  const { data: board } = useLiveQuery(
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

  const { data: posts } = useLiveQuery(
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

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-6">
          {board ? (
            <div className="grid gap-4">
              {posts?.map((post) =>
                post ? (
                  <FeedbackCard board={board} key={post.id} post={post} />
                ) : null
              )}
            </div>
          ) : null}
        </section>

        <aside className="space-y-4">
          <BoardListCard />
        </aside>
      </div>
    </div>
  );
}
