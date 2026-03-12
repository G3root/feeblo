import type { Board } from "@feeblo/domain/board/schema";
import type { Post } from "@feeblo/domain/post/schema";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import { CommentsSection } from "../components/comments/comments-section";
import { postCollection, publicBoardCollection } from "../lib/collections";
import { formatPostStatus, hasRichTextContent } from "../lib/utils";
import { useSite } from "../providers/site-provider";

const statusColors: Record<string, string> = {
  PAUSED: "bg-muted-foreground/50",
  REVIEW: "bg-amber-500",
  PLANNED: "bg-blue-500",
  IN_PROGRESS: "bg-orange-500",
  COMPLETED: "bg-emerald-500",
  CLOSED: "bg-muted-foreground/30",
};

function StatusPill({ status }: { status: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-2 py-0.5">
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          statusColors[status] ?? "bg-muted-foreground/40"
        )}
      />
      <span className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {formatPostStatus(status)}
      </span>
    </div>
  );
}

export function PostPage({ slug }: { slug: string }) {
  const site = useSite();
  const {
    data: post,
    isError: postError,
    isLoading: postLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(eq(post.slug, slug), eq(post.organizationId, site.organizationId))
        )
        .findOne(),
    [site.organizationId, slug]
  );
  const {
    data: boards = [],
    isError: boardsError,
    isLoading: boardsLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
    [site.organizationId]
  );

  if (postLoading || boardsLoading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 text-muted-foreground text-sm sm:px-6 lg:px-8">
        Loading post...
      </div>
    );
  }

  if (postError || boardsError) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border/60 p-10 text-center">
          <p className="font-medium text-sm">Post unavailable</p>
          <p className="mt-1 text-muted-foreground text-sm">
            There was a problem loading this post.
          </p>
        </div>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-border/60 p-10 text-center">
          <p className="font-medium text-sm">Post not found</p>
          <p className="mt-1 text-muted-foreground text-sm">
            This public post does not exist anymore.
          </p>
        </div>
      </div>
    );
  }

  const typedBoards = boards as Board[];
  const typedPost = post as Post;
  const boardName = typedBoards.find(
    (board) => board.id === typedPost.boardId
  )?.name;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <article className="space-y-6">
          <div className="space-y-4">
            <Link
              className={buttonVariants({ size: "sm", variant: "ghost" })}
              href="/"
            >
              Back to feedback
            </Link>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={typedPost.status} />
                {boardName ? (
                  <Badge variant="outline">{boardName}</Badge>
                ) : null}
                <span className="text-muted-foreground text-sm">
                  {typedPost.upVotes} votes
                </span>
              </div>
              <h1 className="font-semibold text-2xl tracking-tight sm:text-3xl">
                {typedPost.title}
              </h1>
              {typedPost.user.name ? (
                <p className="text-muted-foreground text-sm">
                  Shared by {typedPost.user.name}
                </p>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-border/60 bg-card">
            <div className="px-5 py-6">
              {hasRichTextContent(typedPost.content) ? (
                <div
                  className="public-board-rich-text"
                  dangerouslySetInnerHTML={{ __html: typedPost.content }}
                />
              ) : (
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {typedPost.content}
                </p>
              )}
            </div>
          </div>

          <CommentsSection postId={typedPost.id} />
        </article>

        <aside>
          <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-3 font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
                Post details
              </h2>
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-medium">
                    {formatPostStatus(typedPost.status)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Board</span>
                  <span className="truncate font-medium">
                    {boardName ?? "Unassigned"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Votes</span>
                  <span className="font-medium">{typedPost.upVotes}</span>
                </div>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
