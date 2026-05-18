import { generateId } from "@feeblo/utils/id";
import { CircleLockIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@feeblo/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { toastManager } from "@feeblo/ui/toast";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import type { CommentReactionToggleInput } from "~/features/post/components/comment-reaction-section";
import { PostBoardSelect } from "~/features/post/components/post-board-select";
import {
  PostDetails,
  PostDetailsFormSkeleton,
} from "~/features/post/components/post-details-form";
import { StatusSelect } from "~/features/post/components/post-properties";
import { PostSidebarActions } from "~/features/post/components/post-sidebar-actions";
import { TagCreateDialog } from "~/features/tag/components/tag-create-dialog";
import {
  TagList,
  TagSelect,
  type TagSelectOption,
} from "~/features/tag/components/tag-select";
import { TagCreateDialogProvider } from "~/features/tag/dialog-stores";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import {
  boardCollection,
  commentCollection,
  commentReactionCollection,
  postCollection,
  postStatusCollection,
  postTagCollection,
  tagCollection,
} from "~/lib/collections";
import { getCommentReactionCollectionKey } from "~/lib/reaction-keys";
import { fetchRpc } from "~/lib/runtime";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/post/$boardSlug/$postSlug"
)({
  component: RouteComponent,
  pendingComponent: PostDetailsRoutePending,
});

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();

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

  const { data: allBoards } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId));
    },
    [organizationId]
  );
  const { data: postStatuses } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
    [organizationId]
  );

  const { data: tags } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ tags: tagCollection })
        .where(({ tags }) =>
          and(
            eq(tags.organizationId, organizationId),
            eq(tags.type, "FEEDBACK")
          )
        )
        .select(({ tags }) => ({
          id: tags.id,
          name: tags.name,
          type: tags.type,
        }));
    },
    [organizationId]
  );

  const { data: postTags } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ tags: postTagCollection })
        .where(({ tags }) =>
          and(
            eq(tags.postId, post?.id ?? ""),
            eq(tags.organizationId, organizationId)
          )
        )
        .select(({ tags }) => ({
          id: tags.id,
          tagId: tags.tagId,
          typeId: tags.postId,
        }));
    },
    [organizationId, post?.id]
  );

  const { data: comments } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ comment: commentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, organizationId),
            eq(comment.postId, post?.id ?? "")
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [organizationId, post?.id]
  );

  const { data: commentReactions } = useLiveSuspenseQuery(
    (q) =>
      q
        .from({ commentReaction: commentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, organizationId),
            eq(commentReaction.postId, post?.id ?? "")
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
        ),
    [organizationId, post?.id]
  );

  const { allowed: canManagePost } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(organizationId),
      isUser(post?.creatorId ?? "")
    )
  );

  if (!(board && post)) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Post not found</EmptyTitle>
          <EmptyDescription>
            We could not find the requested post.
          </EmptyDescription>
          <EmptyContent>
            <Button
              nativeButton={false}
              render={(props) => (
                <Link
                  {...props}
                  params={{ organizationId }}
                  to="/$organizationId"
                >
                  Go back to dashboard
                </Link>
              )}
              variant="link"
            />
          </EmptyContent>
        </EmptyHeader>
      </Empty>
    );
  }

  const isLocked = post.lockedAt !== null;

  const handleTagSelect = async (
    option: TagSelectOption,
    isSelected: boolean
  ) => {
    try {
      const currentTagIds = postTags.map((tag) => tag.tagId);
      const newTagIds = isSelected
        ? currentTagIds.filter((id) => id !== option.id)
        : [...currentTagIds, option.id];

      await fetchRpc((rpc) =>
        rpc.PostTagSet({
          postId: post.id,
          organizationId,
          tagIds: newTagIds,
        })
      );

      await postTagCollection.utils.refetch();

      toastManager.add({
        title: "Tags updated",
        type: "success",
      });
    } catch (_error) {
      toastManager.add({
        title: "Failed to update tags",
        type: "error",
      });
    }
  };

  const handleAddComment = async ({
    content,
    visibility,
  }: {
    content: string;
    visibility: "PUBLIC" | "INTERNAL";
  }) => {
    if (isLocked) {
      throw new Error("Post is locked");
    }

    if (!session) {
      throw new Error("session not found");
    }

    const postId = post.id;

    const tx = commentCollection.insert({
      id: generateId("comment"),
      createdAt: new Date(),
      updatedAt: new Date(),
      content,
      visibility,
      parentCommentId: null,
      organizationId,
      memberId: null,
      postId,
      userId: session.user.id,
      user: {
        name: session.user.name,
      },
    });

    await tx.isPersisted.promise;
  };

  const handleToggleCommentReaction = async ({
    commentId,
    emoji,
    existingReaction,
    organizationId,
    postId,
    userId,
  }: CommentReactionToggleInput) => {
    if (isLocked) {
      throw new Error("Post is locked");
    }

    if (existingReaction) {
      const tx = commentReactionCollection.delete(
        getCommentReactionCollectionKey(existingReaction)
      );
      await tx.isPersisted.promise;
      return;
    }

    const tx = commentReactionCollection.insert({
      id: generateId("commentReaction"),
      commentId,
      createdAt: new Date(),
      emoji,
      //todo fix
      memberId: null,
      organizationId,
      postId,
      updatedAt: new Date(),
      userId,
    });
    await tx.isPersisted.promise;
  };

  const handleDeleteComment = async (commentId: string) => {
    if (isLocked) {
      throw new Error("Post is locked");
    }

    const tx = commentCollection.delete(commentId);
    await tx.isPersisted.promise;
  };

  return (
    <TagCreateDialogProvider defaultValue={{ data: { type: "FEEDBACK" } }}>
      <div className="grid min-h-full lg:grid-cols-[minmax(0,1fr)_280px]">
        <PostDetails.Layout>
          <PostDetails.Header
            boardName={board.name}
            boardSlug={board.slug}
            organizationId={organizationId}
            postCreatorId={post.creatorId}
            postId={post.id}
            title={post.title}
          />
          <PostStatusAlerts lockedAt={post.lockedAt} />
          <PostDetails.Description
            description={post.content}
            organizationId={organizationId}
            postCreatorId={post.creatorId}
            postId={post.id}
          />
          <Suspense fallback={<PostDetails.ActionsSkeleton />}>
            <div className="flex items-center justify-between py-1">
              <PostDetails.EngagementBar
                disabled={isLocked}
                organizationId={organizationId}
                postId={post.id}
              />
            </div>
          </Suspense>
          <PostDetails.CommentComposer
            defaultVisibility="PUBLIC"
            disabled={isLocked}
            disabledReason="This post is locked, so new comments and notes are disabled until it is unlocked."
            handleAddComment={handleAddComment}
            isAuthenticated
            showVisibilityPicker
          />
          <Suspense fallback={<PostDetails.CommentListSkeleton />}>
            <PostDetails.CommentList.Root
              commentReactions={commentReactions}
              comments={comments}
              handleDeleteComment={handleDeleteComment}
              handleToggleCommentReaction={handleToggleCommentReaction}
              isLocked={isLocked}
              organizationId={organizationId}
              postId={post.id}
            >
              <PostDetails.CommentList.Content>
                <PostDetails.CommentList.Items>
                  <PostDetails.CommentList.Item>
                    <PostDetails.CommentList.Media>
                      <PostDetails.CommentList.Avatar />
                    </PostDetails.CommentList.Media>
                    <PostDetails.CommentList.Main>
                      <PostDetails.CommentList.Header>
                        <PostDetails.CommentList.Author />
                        <PostDetails.CommentList.Timestamp />
                      </PostDetails.CommentList.Header>
                      <PostDetails.CommentList.Body />
                      <PostDetails.CommentList.Reactions />
                    </PostDetails.CommentList.Main>
                    <PostDetails.CommentList.Actions />
                  </PostDetails.CommentList.Item>
                </PostDetails.CommentList.Items>
              </PostDetails.CommentList.Content>
            </PostDetails.CommentList.Root>
          </Suspense>
        </PostDetails.Layout>

        <aside className="hidden px-6 py-6 lg:block">
          <div className="sticky top-0 space-y-4">
            <PostSidebarActions
              boardSlug={boardSlug}
              canManagePost={canManagePost}
              lockedAt={post.lockedAt}
              organizationId={organizationId}
              postId={post.id}
              postSlug={post.slug}
            />

            {canManagePost ? (
              <SidebarCard title="Properties">
                <div>
                  <StatusSelect
                    currentStatusId={post.statusId}
                    onValueChange={async (nextPostStatus) => {
                      if (!nextPostStatus) {
                        return;
                      }
                      try {
                        const tx = postCollection.update(post.id, (draft) => {
                          draft.statusId = nextPostStatus.id;
                        });
                        await tx.isPersisted.promise;

                        toastManager.add({
                          title: "Status updated",
                          type: "success",
                        });
                      } catch (_error) {
                        toastManager.add({
                          title: "Failed to update status",
                          type: "error",
                        });
                      }
                    }}
                    statuses={postStatuses}
                  />
                </div>

                <PostBoardSelect
                  boards={allBoards}
                  currentBoardId={board.id}
                  onValueChange={async (boardId) => {
                    if (!boardId) {
                      return;
                    }
                    try {
                      const nextBoard = allBoards.find(
                        (item) => item.id === boardId
                      );
                      const nextBoardSlug = nextBoard?.slug;
                      const tx = postCollection.update(
                        post.id,
                        {
                          optimistic: false,
                        },
                        (draft) => {
                          draft.boardId = boardId;
                        }
                      );
                      await tx.isPersisted.promise;

                      toastManager.add({
                        title: "Board updated",
                        type: "success",
                      });

                      if (!nextBoardSlug) {
                        return;
                      }

                      navigate({
                        to: "/$organizationId/post/$boardSlug/$postSlug",
                        params: {
                          organizationId,
                          boardSlug: nextBoardSlug,
                          postSlug,
                        },
                        replace: true,
                      });
                    } catch (_error) {
                      toastManager.add({
                        title: "Failed to update board",
                        type: "error",
                      });
                    }
                  }}
                />
              </SidebarCard>
            ) : null}

            <SidebarCard title="Tags">
              <div className="flex flex-wrap items-center gap-1.5">
                <TagList selectedTags={postTags} tags={tags} />
                <TagSelect
                  onTagSelect={handleTagSelect}
                  selectedTags={postTags}
                  tags={tags}
                  type="FEEDBACK"
                />
              </div>
            </SidebarCard>

            <SidebarCard title="Details">
              <p className="text-muted-foreground text-sm">
                {formatPostDate(post.createdAt)}
              </p>

              <p className="text-muted-foreground text-sm">
                {post.user?.name ?? "Unknown author"}
              </p>
            </SidebarCard>
          </div>
        </aside>
      </div>
      <TagCreateDialog />
    </TagCreateDialogProvider>
  );
}

function PostDetailsRoutePending() {
  return <PostDetailsFormSkeleton />;
}

function PostStatusAlerts({ lockedAt }: { lockedAt: Date | string | null }) {
  const isLocked = lockedAt !== null;

  if (!isLocked) {
    return null;
  }

  return (
    <Alert variant="info">
      <HugeiconsIcon icon={CircleLockIcon} />
      <AlertTitle>Locked post</AlertTitle>
      <AlertDescription>
        This post is locked, so members cannot continue interacting with it
        until it is unlocked.
      </AlertDescription>
    </Alert>
  );
}

function SidebarCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
    </Card>
  );
}
