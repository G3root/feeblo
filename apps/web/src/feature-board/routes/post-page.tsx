import { generateId } from "@feeblo/utils/id";
import {
  and,
  debounceStrategy,
  eq,
  useLiveQuery,
  useLiveSuspenseQuery,
  usePacedMutations,
} from "@tanstack/react-db";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, Suspense } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { PostCommentComposer } from "~/features/post/components/post-comment-composer";
import { PostCommentList } from "~/features/post/components/post-comment-list";
import { PostContentEditor } from "~/features/post/components/post-content";
import { PostUpvoteButton } from "~/features/post/components/post-engagement-bar";
import {
  type PostReaction,
  PostReactionSection,
} from "~/features/post/components/post-reaction-section";
import { PostTitleInput } from "~/features/post/components/post-title-input";
import {
  allPolicy,
  anyPolicy,
  hasMembership,
  hasOwnerOrAdminRole,
  isUser,
  usePolicy,
} from "~/hooks/use-policy";
import { authClient } from "~/lib/auth-client";
import { fetchRpc } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { getPostReactionCollectionKey } from "../../dashboard/lib/reaction-keys";
import { AuthDialog } from "../components/common/auth-dialog";
import { BoardNavLink } from "../components/feedback/board-list-card";
import { PostVoterDialog } from "../components/feedback/post-voter-dialog";
import { useUpvote } from "../hooks/use-upvote";
import {
  publicBoardCollection,
  publicPostCollection,
  publicPostReactionCollection,
  publicPostStatusCollection,
  publicPostTagCollection,
  publicTagCollection,
} from "../lib/collections";
import { formatPostStatus, getInitials } from "../lib/utils";
import { useSite } from "../providers/site-provider";

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8 lg:py-14">
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

export function PostPage({ slug }: { slug: string }) {
  const site = useSite();

  const statusQuery = useLiveQuery(
    (q) =>
      q
        .from({ status: publicPostStatusCollection })
        .where(({ status }) => eq(status.organizationId, site.organizationId)),
    [site.organizationId, slug]
  );
  const boardsQuery = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId)),
    [site.organizationId]
  );

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
  const { allowed: canEdit } = usePolicy(
    anyPolicy(
      hasOwnerOrAdminRole(),
      allPolicy(
        hasMembership(site.organizationId),
        isUser(post?.creatorId ?? "")
      )
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

  if (
    postLoading ||
    boardsQuery.isLoading ||
    statusQuery.isLoading ||
    postTagsQuery.isLoading
  ) {
    return <RootLayout>Loading post...</RootLayout>;
  }

  if (
    postError ||
    boardsQuery.isError ||
    statusQuery.isError ||
    postTagsQuery.isError
  ) {
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
  const publishedDate = formatPublishedDate(post.createdAt);
  const selectedTags = postTagsQuery.data ?? [];

  return (
    <RootLayout>
      <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
        <article className="min-w-0 lg:col-span-9">
          <Link
            className={cn(
              buttonVariants({ size: "sm", variant: "ghost" }),
              "mb-8"
            )}
            href="/"
          >
            <ArrowLeft />
            Back
          </Link>

          <div className="flex items-start gap-4 sm:gap-6">
            <div className="shrink-0 pt-1">
              <UpvoteButton
                hasUserUpVoted={post.hasUserUpVoted}
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
                disabled={!canEdit}
                onChange={(value) => contentMutate({ value })}
                value={post.content}
              />

              <Suspense fallback={<PostReactionBarSkeleton />}>
                <PostReactionBar
                  organizationId={site.organizationId}
                  postId={post.id}
                />
              </Suspense>

              <div className="space-y-4">
                <PostCommentComposer
                  organizationId={site.organizationId}
                  postId={post.id}
                  unauthenticatedFallback={<PublicCommentFallback />}
                />
                <PostCommentList
                  emptyState={
                    <p className="py-6 text-center text-muted-foreground text-sm">
                      No comments yet.
                    </p>
                  }
                  organizationId={site.organizationId}
                  postId={post.id}
                />
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
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="space-y-2 border-border/70 border-b pb-3 last:border-b-0 last:pb-0">
      <p className="font-medium text-muted-foreground/80 text-xs tracking-wider">
        {title}
      </p>
      {children}
    </section>
  );
}

function PostMetaSidebarVoters({ postId }: { postId: string }) {
  return (
    <PostVoterDialog.Root postId={postId}>
      <PostMetaSidebarSection title="Voters">
        <PostVoterDialog.Trigger />
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

const PostMetaSidebar = {
  Root: PostMetaSidebarRoot,
  Section: PostMetaSidebarSection,
  Voters: PostMetaSidebarVoters,
  Board: PostMetaSidebarBoard,
  Status: PostMetaSidebarStatus,
  Tags: PostMetaSidebarTags,
  Author: PostMetaSidebarAuthor,
  PublishedOn: PostMetaSidebarPublishedOn,
};

function PublicCommentFallback() {
  return (
    <div className="rounded-xl border border-border/80 px-4 py-4">
      <p className="font-medium text-sm">Join the discussion</p>
      <p className="mt-1 text-muted-foreground text-sm">
        Sign in to leave a comment or react to this post.
      </p>
      <div className="mt-3">
        <AuthDialog variant="sign-in" />
      </div>
    </div>
  );
}

function UpvoteButton({
  hasUserUpVoted,
  postId,
  upvoteCount,
}: {
  hasUserUpVoted: boolean;
  postId: string;
  upvoteCount: number;
}) {
  const site = useSite();
  const organizationId = site.organizationId;

  const { handleToggleUpvote } = useUpvote();

  return (
    <PostUpvoteButton
      handleToggleUpvote={async () => {
        await handleToggleUpvote({
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
  organizationId,
  postId,
}: {
  organizationId: string;
  postId: string;
}) {
  const { data: session } = authClient.useSession();
  const { data: postReactions } = useLiveSuspenseQuery(
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
    emoji: string,
    existingUserEmojiReaction: PostReaction | undefined
  ) => {
    const currentUserId = session?.user?.id;
    const memberships = session?.memberships;
    if (!currentUserId) {
      toastManager.add({ title: "Sign in to react", type: "error" });
      return;
    }
    const isMember = memberships?.find(
      (membership) =>
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
      id: generateId("postReaction"),
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
      handleToggleReaction={handleToggleReaction}
      postReactions={postReactions}
    />
  );
}

function PostReactionBarSkeleton() {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-8 w-16 rounded-full" />
      <Skeleton className="h-8 w-20 rounded-full" />
      <Skeleton className="h-8 w-24 rounded-full" />
    </div>
  );
}
