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
import { Suspense } from "react";
import { Link } from "wouter";
import { z } from "zod";
import { getPostReactionCollectionKey } from "../../dashboard/lib/reaction-keys";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarImage,
} from "~/components/ui/avatar";
import { buttonVariants } from "~/components/ui/button";
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
import { AuthDialog } from "../components/common/auth-dialog";
import { BoardNavLink } from "../components/feedback/board-list-card";
import { useUpvote } from "../hooks/use-upvote";
import {
  publicBoardCollection,
  publicPostCollection,
  publicPostStatusCollection,
  publicPostReactionCollection,
  publicUpvoteCollection,
} from "../lib/collections";
import { formatPostStatus, getInitials } from "../lib/utils";
import { useSite } from "../providers/site-provider";

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

function SidebarSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="border-border/80 border-b pb-5 last:border-b-0 last:pb-0">
      <p className="mb-2 text-muted-foreground text-xs">{title}</p>
      {children}
    </section>
  );
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
  const {
    data: postEntry,
    isError: postError,
    isLoading: postLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ post: publicPostCollection })
        .join(
          { postStatus: publicPostStatusCollection },
          ({ post, postStatus }) => eq(post.statusId, postStatus.id),
          "inner"
        )
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
  const post = postEntry?.post;
  const postStatus = postEntry?.postStatus;
  const postId = post?.id ?? "";
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

  const board = boards.find((board) => board.id === post.boardId);
  const boardName = board?.name ?? "Unassigned";
  const authorName = post?.user?.name ?? "Anonymous";
  const authorInitials = getInitials(post?.user?.name ?? "Anonymous");
  const publishedDate = formatPublishedDate(post.createdAt);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12 lg:px-8 lg:py-14">
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_264px] lg:items-start">
        <article className="min-w-0">
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

        <aside className="lg:pt-16">
          <div className="space-y-5">
            <UpvoteList postId={post.id} />

            <SidebarSection title="Board">
              <BoardNavLink
                href={`/b/${board?.slug ?? ""}`}
                label={boardName ?? "Unassigned"}
                showActiveIndicator
              />
            </SidebarSection>

            <SidebarSection title="Status">
              <StatusPill status={postStatus?.type ?? "PLANNED"} />
            </SidebarSection>

            {/* <SidebarSection title="Tags">
              <p className="text-muted-foreground">No tags assigned</p>
            </SidebarSection> */}

            <SidebarSection title="Posted by">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={post.user.image ?? undefined} />
                  <AvatarFallback>{authorInitials}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-medium text-foreground">{authorName}</p>
                </div>
              </div>
            </SidebarSection>

            <SidebarSection title="Posted on">
              <p className="font-medium text-foreground">{publishedDate}</p>
            </SidebarSection>
          </div>
        </aside>
      </div>
    </div>
  );
}

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

function UpvoteList({ postId }: { postId: string }) {
  const site = useSite();
  const organizationId = site.organizationId;
  const { data: upvotes } = useLiveQuery(
    (q) =>
      q
        .from({ upvote: publicUpvoteCollection })
        .where(({ upvote }) =>
          and(
            eq(upvote.postId, postId),
            eq(upvote.organizationId, organizationId)
          )
        )
        .orderBy(({ upvote }) => upvote.createdAt, "asc"),
    [organizationId, postId]
  );

  if (upvotes?.length === 0) {
    return null;
  }

  return (
    <SidebarSection title="Voters">
      <AvatarGroup>
        {upvotes.map((upvote) => (
          <Avatar key={upvote.id}>
            <AvatarImage src={upvote?.user?.image ?? undefined} />
            <AvatarFallback>{getInitials(upvote.user.name)}</AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
    </SidebarSection>
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
