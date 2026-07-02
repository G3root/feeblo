import { CommentId, CommentReactionId, PostReactionId } from "@feeblo/id";
import type { CommentReactionToggleInput } from "@feeblo/post-ui/comment-reaction-section";
import {
  PostCommentComposer,
  PostCommentGuestPrompt,
} from "@feeblo/post-ui/post-comment-composer";
import { PostCommentList } from "@feeblo/post-ui/post-comment-list";
import { PostContentEditor } from "@feeblo/post-ui/post-content";
import { PostUpvoteButton } from "@feeblo/post-ui/post-engagement-bar";
import {
  type PostReaction,
  PostReactionSection,
} from "@feeblo/post-ui/post-reaction-section";
import { PostTitleInput } from "@feeblo/post-ui/post-title-input";
import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import { htmlToExcerpt } from "@feeblo/utils/html";
import type { ReactionEmoji } from "@feeblo/utils/reaction";
import {
  getCommentReactionCollectionKey,
  getPostReactionCollectionKey,
} from "@feeblo/web-shared/reaction-keys";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import {
  anyPolicy,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { Comment01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  and,
  debounceStrategy,
  eq,
  useLiveQuery,
  usePacedMutations,
} from "@tanstack/react-db";
import {
  createLazyRoute,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { z } from "zod";
import { AuthDialog } from "../components/common/auth-dialog";
import { BoardNavLink } from "../components/feedback/board-list-card";
import { PostPageActions } from "../components/feedback/post-page-actions";
import { PostVoterDialog } from "../components/feedback/post-voter-dialog";
import { useUpvote } from "../hooks/use-upvote";
import { formatPostStatus, getInitials } from "../lib/utils";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      {children}
    </div>
  );
}

const statusColors: Record<string, string> = {
  PENDING: "bg-muted-foreground/50",
  REVIEW: "bg-amber-500",
  PLANNED: "bg-blue-500",
  IN_PROGRESS: "bg-orange-500",
  COMPLETED: "bg-emerald-500",
  CLOSED: "bg-muted-foreground/30",
};

function StatusPill({ status }: { status: string }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5">
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          statusColors[status] ?? "bg-muted-foreground/40"
        )}
      />
      <span className="font-medium text-muted-foreground text-xs">
        {formatPostStatus(status)}
      </span>
    </div>
  );
}

function formatPublishedDate(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

const UpdatedPostSchema = z.object({
  id: z.string(),
  statusId: z.string(),
  content: z.string(),
  title: z.string(),
  boardId: z.string(),
  organizationId: z.string(),
});

type SessionMembership = {
  membershipId: string;
  organizationId: string;
  userId: string;
};

export const Route = createLazyRoute("/p/$slug")({
  component: PostPage,
});

export function PostPage() {
  const site = useSite();
  const { data: session } = useAuthState();
  const navigate = useNavigate();
  const { slug } = useParams({ from: "/p/$slug" });
  const {
    publicBoardCollection,
    publicCommentCollection,
    publicCommentReactionCollection,
    publicPostCollection,
    publicPostStatusCollection,
    publicPostTagCollection,
    publicTagCollection,
  } = usePublicCollections();

  const {
    data: postRow,
    isError: postError,
    isLoading: postLoading,
  } = useLiveQuery(
    (q) => {
      if (!site.organizationId) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(post.boardId, board.id),
          "left"
        )
        .where(({ post }) =>
          and(eq(post.slug, slug), eq(post.organizationId, site.organizationId))
        )
        .findOne();
    },
    [site.organizationId, slug]
  );
  const post = postRow?.post;
  const postStatus = postRow?.postStatus;
  const board = postRow?.board;
  const postId = post?.id ?? "";
  const postTagsQuery = useLiveQuery(
    (q) =>
      q
        .from({ postTag: publicPostTagCollection })
        .join(
          { tag: publicTagCollection },
          ({ postTag, tag }) => eq(postTag.tagId, tag.id),
          "inner"
        )
        .where(({ postTag, tag }) =>
          and(
            eq(postTag.organizationId, site.organizationId),
            eq(postTag.postId, postId),
            eq(tag.organizationId, site.organizationId),
            eq(tag.type, "FEEDBACK")
          )
        )
        .select(({ tag }) => ({
          id: tag.id,
          name: tag.name,
        })),
    [site.organizationId, postId]
  );
  const commentsQuery = useLiveQuery(
    (q) =>
      q
        .from({ comment: publicCommentCollection })
        .where(({ comment }) =>
          and(
            eq(comment.organizationId, site.organizationId),
            eq(comment.postId, postId)
          )
        )
        .orderBy((comment) => comment.comment.createdAt, "desc"),
    [site.organizationId, postId]
  );
  const commentReactionsQuery = useLiveQuery(
    (q) =>
      q
        .from({ commentReaction: publicCommentReactionCollection })
        .where(({ commentReaction }) =>
          and(
            eq(commentReaction.organizationId, site.organizationId),
            eq(commentReaction.postId, postId)
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
    [site.organizationId, postId]
  );
  const { allowed: canEdit } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(site.organizationId),
      isUser(post?.creatorId ?? "")
    )
  );

  const titleMutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      if (!postId) {
        return;
      }

      publicPostCollection.update(postId, (draft) => {
        draft.title = value;
      });
    },
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;
      const validatedPost = UpdatedPostSchema.parse(updatedPost);
      await fetchRpc((rpc) => rpc.PostUpdate(validatedPost));
    },
    strategy: debounceStrategy({ wait: 500 }),
  });

  const contentMutate = usePacedMutations<{ value: string }>({
    onMutate: ({ value }) => {
      if (!postId) {
        return;
      }

      publicPostCollection.update(postId, (draft) => {
        draft.content = value;
        draft.excerpt = htmlToExcerpt(value);
      });
    },
    mutationFn: async ({ transaction }) => {
      const mutation = transaction.mutations[0];
      const { modified: updatedPost } = mutation;
      const validatedPost = UpdatedPostSchema.parse(updatedPost);
      await fetchRpc((rpc) => rpc.PostUpdate(validatedPost));
    },
    strategy: debounceStrategy({ wait: 500 }),
  });

  if (postLoading || postTagsQuery.isLoading) {
    return <RootLayout>Loading post...</RootLayout>;
  }

  if (postError || postTagsQuery.isError) {
    return (
      <RootLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Post unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading this post.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </RootLayout>
    );
  }

  if (!post) {
    return (
      <RootLayout>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Post not found</EmptyTitle>
            <EmptyDescription>
              This public post does not exist anymore.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </RootLayout>
    );
  }

  const boardName = board?.name ?? "Unassigned";
  const authorName = post?.user?.name ?? "Anonymous";
  const authorInitials = getInitials(post?.user?.name ?? "Anonymous");
  const isLocked = post.lockedAt !== null;
  const publishedDate = formatPublishedDate(post.createdAt);
  const selectedTags = postTagsQuery.data ?? [];

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

    const tx = publicCommentCollection.insert({
      id: await CommentId.unsafeGenerate(),
      createdAt: new Date(),
      updatedAt: new Date(),
      content,
      visibility,
      parentCommentId: null,
      organizationId: site.organizationId,
      //todo fix
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
      const tx = publicCommentReactionCollection.delete(
        getCommentReactionCollectionKey(existingReaction)
      );
      await tx.isPersisted.promise;
      return;
    }

    const tx = publicCommentReactionCollection.insert({
      id: await CommentReactionId.unsafeGenerate(),
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

    const tx = publicCommentCollection.delete(commentId);
    await tx.isPersisted.promise;
  };

  const handleDeletePost = async () => {
    try {
      const tx = publicPostCollection.delete(postId);
      await tx.isPersisted.promise;
      navigate({ to: "/" });
    } catch (_error) {
      toastManager.add({
        title: "Failed to delete post",
        type: "error",
      });
      throw _error;
    }
  };

  return (
    <RootLayout>
      <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
        <article className="min-w-0 lg:col-span-9">
          <PostPageActions canDelete={canEdit} onDelete={handleDeletePost} />

          <div className="flex items-start gap-4 sm:gap-6">
            <div className="shrink-0 pt-1">
              <UpvoteButton
                hasUserUpVoted={post.hasUserUpVoted}
                isLocked={isLocked}
                postId={post.id}
                upvoteCount={post.upVotes}
              />
            </div>

            <div className="min-w-0 flex-1 space-y-6">
              <div className="space-y-3">
                <PostTitleInput
                  defaultValue={post.title}
                  onChange={
                    canEdit
                      ? (event) => {
                          const value = event.target.value;
                          if (value.trim() === "") {
                            toastManager.add({
                              title: "Title is required",
                              type: "error",
                            });
                            return;
                          }
                          titleMutate({ value });
                        }
                      : undefined
                  }
                  readOnly={!canEdit}
                />
              </div>

              <PostContentEditor
                onChange={(value) => contentMutate({ value })}
                readOnly={!canEdit}
                value={post.content}
              />

              <PostReactionBar
                disabled={isLocked}
                organizationId={site.organizationId}
                postId={post.id}
              />

              <div className="space-y-4">
                <PostCommentComposer
                  defaultVisibility="PUBLIC"
                  disabled={isLocked}
                  disabledReason="This post is locked, so new comments are disabled until it is unlocked."
                  handleAddComment={handleAddComment}
                  isAuthenticated={!!session?.session}
                />
                <PostCommentGuestPrompt
                  action={<AuthDialog variant="sign-in" />}
                  isAuthenticated={!!session?.session}
                />
                <PostCommentList.Root
                  commentReactions={commentReactionsQuery.data ?? []}
                  comments={commentsQuery.data ?? []}
                  handleDeleteComment={handleDeleteComment}
                  handleToggleCommentReaction={handleToggleCommentReaction}
                  isError={
                    commentsQuery.isError || commentReactionsQuery.isError
                  }
                  isLoading={
                    commentsQuery.isLoading || commentReactionsQuery.isLoading
                  }
                  isLocked={isLocked}
                  organizationId={site.organizationId}
                  postId={post.id}
                >
                  <PostCommentList.Content
                    emptyState={
                      <Empty>
                        <EmptyHeader>
                          <EmptyMedia variant="icon">
                            <HugeiconsIcon icon={Comment01Icon} />
                          </EmptyMedia>
                          <EmptyTitle>No comments yet.</EmptyTitle>
                        </EmptyHeader>
                      </Empty>
                    }
                  >
                    <PostCommentList.Items>
                      <PostCommentList.Item>
                        <PostCommentList.Media>
                          <PostCommentList.Avatar />
                        </PostCommentList.Media>
                        <PostCommentList.Main>
                          <PostCommentList.Header>
                            <PostCommentList.Author />
                            <PostCommentList.Timestamp />
                          </PostCommentList.Header>
                          <PostCommentList.Body />
                          <PostCommentList.Reactions />
                        </PostCommentList.Main>
                        <PostCommentList.Actions />
                      </PostCommentList.Item>
                    </PostCommentList.Items>
                  </PostCommentList.Content>
                </PostCommentList.Root>
              </div>
            </div>
          </div>
        </article>

        <PostMetaSidebar.Root>
          <PostMetaSidebar.Voters postId={post.id} />
          <PostMetaSidebar.Board
            boardName={boardName}
            boardSlug={board?.slug}
          />
          <PostMetaSidebar.Status status={postStatus?.type ?? "PLANNED"} />
          <PostMetaSidebar.Tags tags={selectedTags} />
          <PostMetaSidebar.Author
            authorImage={post.user.image ?? undefined}
            authorInitials={authorInitials}
            authorName={authorName}
          />
          <PostMetaSidebar.PublishedOn publishedDate={publishedDate} />
          {/* <PostMetaSidebar.Share /> */}
        </PostMetaSidebar.Root>
      </div>
    </RootLayout>
  );
}

function PostMetaSidebarRoot({ children }: { children: ReactNode }) {
  return (
    <aside className="lg:col-span-3 lg:pt-16">
      <div className="space-y-3 rounded-2xl bg-background/80 p-4">
        {children}
      </div>
    </aside>
  );
}

function PostMetaSidebarSection({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  return (
    <section className="space-y-2 border-border/70 border-b pb-3 last:border-b-0 last:pb-0">
      <div className="flex items-center justify-between">
        <p className="font-medium text-muted-foreground/80 text-xs tracking-wider">
          {title}
        </p>
        {actions}
      </div>
      {children}
    </section>
  );
}

function PostMetaSidebarVoters({ postId }: { postId: string }) {
  return (
    <PostVoterDialog.Root postId={postId}>
      <PostMetaSidebarSection
        actions={<PostVoterDialog.Trigger />}
        title="Voters"
      >
        <PostVoterDialog.Items />
        <PostVoterDialog.Content />
      </PostMetaSidebarSection>
    </PostVoterDialog.Root>
  );
}

function PostMetaSidebarBoard({
  boardName,
  boardSlug,
}: {
  boardName: string;
  boardSlug?: string | null;
}) {
  return (
    <PostMetaSidebarSection title="Board">
      <BoardNavLink
        href={`/b/${boardSlug ?? ""}`}
        label={boardName}
        showActiveIndicator
      />
    </PostMetaSidebarSection>
  );
}

function PostMetaSidebarStatus({ status }: { status: string }) {
  return (
    <PostMetaSidebarSection title="Status">
      <StatusPill status={status} />
    </PostMetaSidebarSection>
  );
}

function PostMetaSidebarTags({
  tags,
}: {
  tags: Array<{ id: string; name: string }>;
}) {
  if (tags.length === 0) {
    return null;
  }

  return (
    <PostMetaSidebarSection title="Tags">
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Badge
            className="h-6 rounded-full border-border/70 bg-muted/40 px-2.5 text-foreground"
            key={tag.id}
            variant="outline"
          >
            {tag.name}
          </Badge>
        ))}
      </div>
    </PostMetaSidebarSection>
  );
}

function PostMetaSidebarAuthor({
  authorImage,
  authorInitials,
  authorName,
}: {
  authorImage?: string;
  authorInitials: string;
  authorName: string;
}) {
  return (
    <PostMetaSidebarSection title="Posted by">
      <div className="flex items-center gap-2.5">
        <Avatar className="size-8">
          <AvatarImage src={authorImage} />
          <AvatarFallback>{authorInitials}</AvatarFallback>
        </Avatar>
        <p className="font-medium text-foreground text-sm">{authorName}</p>
      </div>
    </PostMetaSidebarSection>
  );
}

function PostMetaSidebarPublishedOn({
  publishedDate,
}: {
  publishedDate: string;
}) {
  return (
    <PostMetaSidebarSection title="Posted on">
      <p className="font-medium text-foreground text-sm">{publishedDate}</p>
    </PostMetaSidebarSection>
  );
}

function ShareFeedBack() {
  return (
    <PostMetaSidebarSection title="Share this feedback">
      <Button className="-ml-2 w-full justify-start" size="sm" variant="ghost">
        Copy Link
      </Button>
    </PostMetaSidebarSection>
  );
}

const PostMetaSidebar = {
  Root: PostMetaSidebarRoot,
  Section: PostMetaSidebarSection,
  Voters: PostMetaSidebarVoters,
  Board: PostMetaSidebarBoard,
  Status: PostMetaSidebarStatus,
  Tags: PostMetaSidebarTags,
  Author: PostMetaSidebarAuthor,
  PublishedOn: PostMetaSidebarPublishedOn,
  Share: ShareFeedBack,
};

function UpvoteButton({
  hasUserUpVoted,
  isLocked = false,
  postId,
  upvoteCount,
}: {
  hasUserUpVoted: boolean;
  isLocked?: boolean;
  postId: string;
  upvoteCount: number;
}) {
  const site = useSite();
  const organizationId = site.organizationId;

  const { handleToggleUpvote } = useUpvote();

  return (
    <PostUpvoteButton
      disabled={isLocked}
      handleToggleUpvote={async () => {
        await handleToggleUpvote({
          disabled: isLocked,
          postId,
          organizationId,
          existingUpvote: hasUserUpVoted,
        });
      }}
      isUpvoted={hasUserUpVoted}
      upvoteCount={upvoteCount}
      variant="compact"
    />
  );
}

function PostReactionBar({
  disabled = false,
  organizationId,
  postId,
}: {
  disabled?: boolean;
  organizationId: string;
  postId: string;
}) {
  const { data: session } = useAuthState();
  const { publicPostReactionCollection } = usePublicCollections();
  const { data: postReactions } = useLiveQuery(
    (q) =>
      q
        .from({ postReaction: publicPostReactionCollection })
        .where(({ postReaction }) =>
          and(
            eq(postReaction.organizationId, organizationId),
            eq(postReaction.postId, postId)
          )
        ),
    [organizationId, postId]
  );

  const handleToggleReaction = async (
    emoji: ReactionEmoji,
    existingUserEmojiReaction: PostReaction | undefined
  ) => {
    if (disabled) {
      return;
    }

    const currentUserId = session?.user?.id;
    const memberships = (
      session as { memberships?: SessionMembership[] } | null
    )?.memberships;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }
    const isMember = memberships?.find(
      (membership: SessionMembership) =>
        membership.userId === currentUserId &&
        membership.organizationId === organizationId
    );

    if (existingUserEmojiReaction) {
      const tx = publicPostReactionCollection.delete(
        getPostReactionCollectionKey(existingUserEmojiReaction)
      );
      await tx.isPersisted.promise;
      return;
    }
    const tx = publicPostReactionCollection.insert({
      id: await PostReactionId.unsafeGenerate(),
      createdAt: new Date(),
      updatedAt: new Date(),
      organizationId,
      postId,
      userId: currentUserId,
      memberId: isMember ? isMember.membershipId : null,
      emoji,
    });
    await tx.isPersisted.promise;
  };

  return (
    <PostReactionSection
      disabled={disabled}
      handleToggleReaction={handleToggleReaction}
      postReactions={postReactions}
    />
  );
}
