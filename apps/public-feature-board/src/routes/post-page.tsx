import { PostCommentGuestPrompt } from "@feeblo/post-ui/post-comment-composer";
import { PostPage as ComposedPostPage } from "@feeblo/post-ui/post-page";
import { usePostCollectionData } from "@feeblo/post-ui/post-page-context";
import { Avatar, AvatarFallback, AvatarImage } from "@feeblo/ui/avatar";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import { cn } from "@feeblo/ui/utils";
import { and, eq, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AuthDialog } from "../components/common/auth-dialog";
import { BoardNavLink } from "../components/feedback/board-list-card";
import { PostPageActions } from "../components/feedback/post-page-actions";
import { PostVoterDialog } from "../components/feedback/post-voter-dialog";
// import { useUpvote } from "../hooks/use-upvote";
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

export const Route = createLazyRoute("/p/$slug")({
  component: PostPage,
});

export function PostPage() {
  const site = useSite();
  const organizationId = site.organizationId;
  const { slug } = useParams({ from: "/p/$slug" });
  const {
    publicBoardCollection,
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

  if (!(post && board)) {
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

  const selectedTags = postTagsQuery.data ?? [];

  return (
    <ComposedPostPage.Root
      board={board}
      organizationId={organizationId}
      pageType="PublicPage"
      post={post}
    >
      <RootLayout>
        <div className="grid gap-10 lg:grid-cols-12 lg:items-start">
          <article className="min-w-0 lg:col-span-9">
            <PostPageActions />

            <div className="flex items-start gap-4 sm:gap-6">
              <div className="shrink-0 pt-1">
                <ComposedPostPage.CompactVote />
              </div>

              <div className="min-w-0 flex-1 space-y-6">
                <div className="space-y-3">
                  <ComposedPostPage.Title />
                </div>

                <ComposedPostPage.Content />

                <ComposedPostPage.Reactions />

                <div className="space-y-4">
                  <ComposedPostPage.PublicCommentComposer />
                  <ComposedPostPage.Guest>
                    <PostCommentGuestPrompt
                      action={<AuthDialog variant="sign-in" />}
                      isAuthenticated={false}
                    />
                  </ComposedPostPage.Guest>

                  <ComposedPostPage.Comments />
                </div>
              </div>
            </div>
          </article>

          <PostMetaSidebar.Root>
            <PostMetaSidebar.Voters />
            <PostMetaSidebar.Board />
            <PostMetaSidebar.Status status={postStatus?.type ?? "PLANNED"} />
            <PostMetaSidebar.Tags tags={selectedTags} />
            <PostMetaSidebar.Author />
            <PostMetaSidebar.PublishedOn />
            {/* <PostMetaSidebar.Share /> */}
          </PostMetaSidebar.Root>
        </div>
      </RootLayout>
    </ComposedPostPage.Root>
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

function PostMetaSidebarVoters() {
  const { post } = usePostCollectionData();
  return (
    <PostVoterDialog.Root postId={post.id}>
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

function PostMetaSidebarBoard() {
  const { board } = usePostCollectionData();
  return (
    <PostMetaSidebarSection title="Board">
      <BoardNavLink
        href={`/b/${board.slug ?? ""}`}
        label={board.name}
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

function PostMetaSidebarAuthor() {
  const { post } = usePostCollectionData();
  const authorName = post?.user?.name ?? "Anonymous";
  const authorInitials = getInitials(authorName);
  const authorImage = post?.user?.image ?? undefined;
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

function PostMetaSidebarPublishedOn() {
  const { post } = usePostCollectionData();
  const publishedDate = formatPublishedDate(post.createdAt);
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
