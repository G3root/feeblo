import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense } from "react";
import { CommentDeleteDialog } from "~/features/post/components/comment-delete-dialog";
import {
  PostDetails,
  PostDetailsFormSkeleton,
} from "~/features/post/components/post-details-form";
import { CommentDeleteDialogProvider } from "~/features/post/dialog-stores";
import { boardCollection, postCollection } from "~/lib/collections";

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
      <PostDetails.Layout>
        <PostDetails.Header
          boardName={board.name}
          boardSlug={board.slug}
          organizationId={organizationId}
          postCreatorId={post.creatorId}
          postId={post.id}
          title={post.title}
        />
        <PostDetails.Description
          description={post.content}
          organizationId={organizationId}
          postCreatorId={post.creatorId}
          postId={post.id}
        />
        <Suspense fallback={<PostDetails.ActionsSkeleton />}>
          <PostDetails.Actions
            organizationId={organizationId}
            postId={post.id}
          />
        </Suspense>
        <PostDetails.CommentComposer
          organizationId={organizationId}
          postId={post.id}
        />
        <Suspense fallback={<PostDetails.CommentListSkeleton />}>
          <PostDetails.CommentList
            organizationId={organizationId}
            postId={post.id}
          />
        </Suspense>
        <p className="text-muted-foreground text-xs">
          Created {post.createdAt.toLocaleDateString()}
        </p>
      </PostDetails.Layout>
      <CommentDeleteDialog />
    </CommentDeleteDialogProvider>
  );
}

function PostDetailsRoutePending() {
  return <PostDetailsFormSkeleton />;
}
