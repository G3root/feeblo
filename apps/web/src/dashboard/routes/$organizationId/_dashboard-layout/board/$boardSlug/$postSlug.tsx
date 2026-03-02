import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CommentDeleteDialog } from "~/features/post/components/comment-delete-dialog";
import {
  PostDetailsForm,
  PostDetailsFormSkeleton,
} from "~/features/post/components/post-details-form";
import { CommentDeleteDialogProvider } from "~/features/post/dialog-stores";
import {
  boardCollection,
  commentCollection,
  commentReactionCollection,
  postCollection,
  postReactionCollection,
  upvoteCollection,
} from "~/lib/collections";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/$postSlug"
)({
  component: RouteComponent,
  pendingComponent: PostDetailsRoutePending,
});

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();

  const { data: board } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) =>
          and(
            eq(board.slug, boardSlug),
            eq(board.organizationId, organizationId)
          )
        )
        .findOne();
    },
    [boardSlug, organizationId]
  );

  const { data: post } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.slug, postSlug),
            eq(post.organizationId, organizationId),
            eq(post.boardId, board?.id)
          )
        )
        .findOne();
    },
    [postSlug, organizationId, board?.id]
  );

  const { data: comments } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postId, post?.id)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc");
    },
    [organizationId, post?.id]
  );

  const { data: commentReactions } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ commentReaction: commentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postId, post?.id)
          )
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.commentId,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.emoji,
          "asc"
        )
        .orderBy(
          (commentReaction) => commentReaction.commentReaction.createdAt,
          "asc"
        );
    },
    [organizationId, post?.id]
  );

  const { data: upvotes } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ upvote: upvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.organizationId, organizationId),
            eq(upvote.postId, post?.id)
          )
        );
    },
    [organizationId, post?.id]
  );

  const { data: postReactions } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ postReaction: postReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postId, post?.id)
          )
        )
        .orderBy((postReaction) => postReaction.postReaction.emoji, "asc")
        .orderBy((postReaction) => postReaction.postReaction.createdAt, "asc");
    },
    [organizationId, post?.id]
  );

  if (!(board && post)) {
    return (
      <div className="mx-auto w-full max-w-5xl p-6">
        <h1 className="font-semibold text-2xl tracking-tight">
          Post not found
        </h1>
        <p className="mt-2 text-muted-foreground text-sm">
          We could not find the requested post.
        </p>
        <Link
          className="mt-4 inline-block text-primary text-sm underline underline-offset-4"
          params={{ organizationId }}
          to="/$organizationId"
        >
          Go back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <CommentDeleteDialogProvider>
      <PostDetailsForm
        boardName={board.name}
        boardSlug={board.slug}
        commentReactions={commentReactions}
        comments={comments}
        createdAt={post.createdAt}
        description={post.content}
        initialTitle={post.title}
        organizationId={organizationId}
        postId={post.id}
        postReactions={postReactions}
        upvotes={upvotes}
      />
      <CommentDeleteDialog />
    </CommentDeleteDialogProvider>
  );
}

function PostDetailsRoutePending() {
  return <PostDetailsFormSkeleton />;
}
