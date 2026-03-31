import {
  Copy01Icon,
  LinkSquare02Icon,
  Trash2,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Suspense } from "react";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { toastManager } from "~/components/ui/toast";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import type { BoardPostStatus } from "~/features/board/constants";
import { CommentDeleteDialog } from "~/features/post/components/comment-delete-dialog";
import { PostBoardSelect } from "~/features/post/components/post-board-select";
import {
  PostDetails,
  PostDetailsFormSkeleton,
} from "~/features/post/components/post-details-form";
import { StatusSelect } from "~/features/post/components/post-properties";
import {
  CommentDeleteDialogProvider,
  usePostDeleteDialogContext,
} from "~/features/post/dialog-stores";
import {
  TagList,
  TagSelect,
  type TagSelectOption,
} from "~/features/tag/components/tag-select";
import { getPublicSiteUrl } from "~/hooks/use-site";
import {
  boardCollection,
  postCollection,
  postTagCollection,
  tagCollection,
} from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

export const Route = createFileRoute(
  "/$organizationId/_dashboard-layout/board/$boardSlug/$postSlug"
)({
  component: RouteComponent,
  pendingComponent: PostDetailsRoutePending,
});

function RouteComponent() {
  const { organizationId, boardSlug, postSlug } = Route.useParams();
  const navigate = useNavigate();
  const postDialogStore = usePostDeleteDialogContext();

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

  const currentStatus = (post.status as BoardPostStatus) ?? "PLANNED";

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

  return (
    <CommentDeleteDialogProvider>
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
          <PostDetails.Description
            description={post.content}
            organizationId={organizationId}
            postCreatorId={post.creatorId}
            postId={post.id}
          />
          <Suspense fallback={<PostDetails.ActionsSkeleton />}>
            <div className="flex items-center justify-between py-1">
              <PostDetails.EngagementBar
                organizationId={organizationId}
                postId={post.id}
              />
            </div>
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

        <aside className="hidden px-6 py-6 lg:block">
          <div className="sticky top-0 space-y-4">
            <div className="flex items-center justify-end gap-2">
              <RedirectToPostUrlButton postSlug={post.slug} />
              <CopyPostButton postSlug={post.slug} />
              <Button
                aria-label="Close"
                className="rounded-full"
                onClick={() =>
                  postDialogStore.send({
                    type: "toggle",
                    data: {
                      postId: post.id,
                      redirectOptions: {
                        to: "/$organizationId/board/$boardSlug",
                        params: {
                          organizationId,
                          boardSlug,
                        },
                      },
                    },
                  })
                }
                size="icon-sm"
                variant="outline"
              >
                <HugeiconsIcon icon={Trash2} />
              </Button>
            </div>

            <SidebarCard title="Properties">
              <div>
                <StatusSelect
                  currentStatus={currentStatus}
                  onValueChange={async (status) => {
                    if (!status) {
                      return;
                    }
                    try {
                      const tx = postCollection.update(post.id, (draft) => {
                        draft.status = status;
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
                      to: "/$organizationId/board/$boardSlug/$postSlug",
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

            <SidebarCard title="Tags">
              <div className="flex flex-wrap items-center gap-1.5">
                <TagList selectedTags={postTags} tags={tags} />
                <TagSelect
                  onTagSelect={handleTagSelect}
                  selectedTags={postTags}
                  tags={tags}
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
      <CommentDeleteDialog />
    </CommentDeleteDialogProvider>
  );
}

function PostDetailsRoutePending() {
  return <PostDetailsFormSkeleton />;
}

function RedirectToPostUrlButton({ postSlug }: { postSlug: string }) {
  const publicSiteUrl = getPublicSiteUrl();

  if (!publicSiteUrl) {
    return null;
  }

  return (
    <Button
      className="rounded-full"
      nativeButton={false}
      render={(props) => (
        <a
          {...props}
          href={`${publicSiteUrl}/p/${postSlug}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          <HugeiconsIcon icon={LinkSquare02Icon} />
        </a>
      )}
      size="icon-sm"
      variant="outline"
    />
  );
}

function CopyPostButton({ postSlug }: { postSlug: string }) {
  const publicSiteUrl = getPublicSiteUrl();

  if (!publicSiteUrl) {
    return null;
  }

  return (
    <Button
      className="rounded-full"
      onClick={() => {
        try {
          navigator.clipboard.writeText(`${publicSiteUrl}/p/${postSlug}`);
          toastManager.add({
            title: "Post URL copied to clipboard",
            type: "success",
          });
        } catch (_error) {
          toastManager.add({
            title: "Failed to copy post URL to clipboard",
            type: "error",
          });
        }
      }}
      size="icon-sm"
      variant="outline"
    >
      <HugeiconsIcon icon={Copy01Icon} />
    </Button>
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
