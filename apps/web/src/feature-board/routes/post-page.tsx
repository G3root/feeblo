import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "wouter";
import { CommentsSection } from "../components/comments/comments-section";
import type { Board } from "@feeblo/domain/board/schema";
import type { Post } from "@feeblo/domain/post/schema";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { boardCollection, postCollection } from "../lib/collections";
import { formatPostStatus, hasRichTextContent } from "../lib/utils";
import { useSite } from "../providers/site-provider";

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
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
    [site.organizationId]
  );

  if (postLoading || boardsLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-muted-foreground text-sm sm:px-6 lg:px-8">
        Loading post...
      </div>
    );
  }

  if (postError || boardsError) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle>Post unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            There was a problem loading this post.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!post) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle>Post not found</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            This public post does not exist anymore.
          </CardContent>
        </Card>
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
                {boardName ? <Badge variant="outline">{boardName}</Badge> : null}
                <Badge>{formatPostStatus(typedPost.status)}</Badge>
                <span className="text-muted-foreground text-sm">
                  {typedPost.upVotes} votes
                </span>
              </div>
              <h1 className="font-semibold text-3xl tracking-tight">
                {typedPost.title}
              </h1>
              {typedPost.user.name ? (
                <p className="text-muted-foreground text-sm">
                  Shared by {typedPost.user.name}
                </p>
              ) : null}
            </div>
          </div>

          <Card className="ring-1 ring-border/60">
            <CardContent className="pt-6">
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
            </CardContent>
          </Card>

          <CommentsSection postId={typedPost.id} />
        </article>

        <aside>
          <Card className="ring-1 ring-border/60">
            <CardHeader>
              <CardTitle>Post details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <span className="font-medium">
                  {formatPostStatus(typedPost.status)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Board</span>
                <span className="font-medium">{boardName ?? "Unassigned"}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Votes</span>
                <span className="font-medium">{typedPost.upVotes}</span>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
