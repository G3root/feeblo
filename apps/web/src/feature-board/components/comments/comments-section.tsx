import { and, eq, useLiveQuery } from "@tanstack/react-db";
import type { Comment } from "@feeblo/domain/comments/schema";
import { generateId } from "@feeblo/utils/id";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { authClient } from "~/lib/auth-client";
import { commentCollection } from "../../lib/collections";
import { getDashboardSignInUrl, toSortedByCreatedAt } from "../../lib/utils";
import { useSite } from "../../providers/site-provider";
import { CommentComposer } from "./comment-composer";
import { CommentThread } from "./comment-thread";
import { CommentsEmptyState } from "./comments-empty-state";
import { CommentsHeader } from "./comments-header";

export function CommentsSection({ postId }: { postId: string }) {
  const site = useSite();
  const { data: session } = authClient.useSession();
  const commentsQuery = useLiveQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, site.organizationId),
            eq(comment.postId, postId)
          )
        ),
    [postId, site.organizationId]
  );
  const canComment = Boolean(session?.user?.id && session.user.name);
  const currentUserName = session?.user?.name ?? null;
  const sortedComments = toSortedByCreatedAt(
    (commentsQuery.data ?? []) as Comment[]
  );
  const repliesByParentId = new Map<string, Comment[]>();

  for (const comment of sortedComments) {
    if (!comment.parentCommentId) {
      continue;
    }

    const existingReplies =
      repliesByParentId.get(comment.parentCommentId) ?? [];
    existingReplies.push(comment);
    repliesByParentId.set(comment.parentCommentId, existingReplies);
  }

  const rootComments = sortedComments.filter(
    (comment) => comment.parentCommentId === null
  );

  if (commentsQuery.isLoading) {
    return <p className="text-muted-foreground text-sm">Loading comments...</p>;
  }

  if (commentsQuery.isError) {
    return (
      <Card className="ring-1 ring-border/60">
        <CardHeader>
          <CardTitle>Comments unavailable</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">
          There was a problem loading comments for this post.
        </CardContent>
      </Card>
    );
  }

  return (
    <section className="space-y-4">
      <CommentsHeader totalComments={sortedComments.length} />

      {canComment && currentUserName ? (
        <CommentComposer
          onSubmit={async (content) => {
            const userId = session?.user?.id;
            const userName = session?.user?.name;

            if (!(userId && userName)) {
              throw new Error("User not found");
            }

            const tx = commentCollection.insert({
              id: generateId("comment"),
              content,
              createdAt: new Date(),
              updatedAt: new Date(),
              organizationId: site.organizationId,
              postId,
              userId,
              visibility: "PUBLIC",
              parentCommentId: null,
              memberId: null,
              user: {
                name: userName,
              },
            });

            await tx.isPersisted.promise;
          }}
          placeholder="Share your thoughts..."
          submitLabel="Comment"
          userName={currentUserName}
        />
      ) : (
        <Card className="ring-1 ring-border/60">
          <CardHeader>
            <CardTitle>Join the discussion</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-muted-foreground text-sm">
            <p>Sign in from the main workspace to leave a public comment.</p>
            <div>
              <a
                className={buttonVariants({ variant: "outline" })}
                href={getDashboardSignInUrl()}
              >
                Sign in
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {rootComments.length === 0 ? (
        <CommentsEmptyState />
      ) : (
        <div className="space-y-4">
          {rootComments.map((comment) => (
            <CommentThread
              canReply={canComment}
              comment={comment}
              currentUserName={currentUserName}
              key={comment.id}
              onSubmitReply={async (content, parentCommentId) => {
                const userId = session?.user?.id;
                const userName = session?.user?.name;

                if (!(userId && userName)) {
                  throw new Error("User not found");
                }

                const tx = commentCollection.insert({
                  id: generateId("comment"),
                  content,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                  organizationId: site.organizationId,
                  postId,
                  userId,
                  visibility: "PUBLIC",
                  parentCommentId,
                  memberId: null,
                  user: {
                    name: userName,
                  },
                });

                await tx.isPersisted.promise;
              }}
              repliesByParentId={repliesByParentId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
