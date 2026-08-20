import { PostCard } from "@feeblo/post-ui/post/post-card";
import { StandaloneUpvoteButton } from "@feeblo/post-ui/upvote-toggle";
import { Button } from "@feeblo/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@feeblo/ui/empty";
import * as dayjs from "@feeblo/utils/dayjs";
import { MessageMultiple01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCreateBoardDialogContext } from "~/features/board/dialog-stores";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { upvoteCollection } from "~/lib/collections";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Post {
  id: string;
  slug: string;
  boardId: string;
  statusId: string | null;
  title: string;
  excerpt: string | null;
  createdAt: Date | string;
  user?: {
    name: string | null;
    image: string | null;
  } | null;
}

interface Board {
  id: string;
  name: string;
  slug: string;
}

interface Status {
  id: string;
  type: string;
}

interface RecentPostsSectionProps {
  organizationId: string;
  isLoading: boolean;
  isError: boolean;
  recentPosts: Post[];
  boards: Board[];
  statuses: Status[];
}

// ---------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------

export function RecentPostsSection({
  organizationId,
  isLoading,
  isError,
  recentPosts,
  boards,
  statuses,
}: RecentPostsSectionProps) {
  const boardMap = new Map(boards.map((b) => [b.id, b]));

  return (
    <section>
      <h2 className="text-muted-foreground mb-3 text-sm font-medium">
        Recent posts
      </h2>

      {isLoading ? (
        <RecentPostsSkeleton />
      ) : isError ? (
        <div className="border-border/70 bg-muted/20 text-muted-foreground flex min-h-32 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
          There was a problem loading your recent posts.
        </div>
      ) : recentPosts.length > 0 ? (
        <div className="divide-border/40 border-border/60 overflow-hidden rounded-xl border">
          {recentPosts.map((post) => {
            const board = boardMap.get(post.boardId);
            const status = statuses.find((s) => s.id === post.statusId);
            const description =
              (post.excerpt && post.excerpt.trim().length > 0
                ? post.excerpt.length > 100
                  ? `${post.excerpt.slice(0, 99).trimEnd()}...`
                  : post.excerpt
                : "No details yet.") ||
              `${board?.name ?? ""}${board?.name ? " · " : ""}${dayjs.default(post.createdAt).format("MMM D")}`;

            return (
              <PostCard.Root key={post.id}>
                <PostCard.Link
                  label={`View ${post.title}`}
                  params={{
                    organizationId,
                    boardSlug: board?.slug ?? "",
                    postSlug: post.slug,
                  }}
                  to="/$organizationId/post/$boardSlug/$postSlug"
                />
                <PostCard.Media>
                  <StandaloneUpvoteButton
                    organizationId={organizationId}
                    postId={post.id}
                    upvoteCollection={upvoteCollection}
                    variant="compact"
                  />
                </PostCard.Media>
                <PostCard.Body>
                  <PostCard.Title>{post.title}</PostCard.Title>
                  <PostCard.Description>{description}</PostCard.Description>
                  <PostCard.MobileMeta
                    boardName={board?.name ?? ""}
                    image={post.user?.image}
                    name={post.user?.name}
                  />
                </PostCard.Body>
                <PostCard.DesktopMeta>
                  {status && <PostCard.Status status={status.type} />}
                  {board?.name && (
                    <PostCard.BoardBadge>{board.name}</PostCard.BoardBadge>
                  )}
                  <PostCard.Author
                    image={post.user?.image}
                    name={post.user?.name}
                  />
                </PostCard.DesktopMeta>
              </PostCard.Root>
            );
          })}
        </div>
      ) : (
        <EmptyState boards={boards} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ boards }: { boards: Board[] }) {
  const createPostStore = usePostCreateDialogContext();
  const createBoardStore = useCreateBoardDialogContext();

  const hasBoards = boards.length > 0;

  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <HugeiconsIcon icon={MessageMultiple01Icon} />
        </EmptyMedia>
        <EmptyTitle>No posts yet</EmptyTitle>
        <EmptyDescription>
          {hasBoards
            ? "Create your first post to start collecting and organizing feedback from your users."
            : "Create your first board to start collecting posts and feedback."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {hasBoards ? (
          <Button
            onClick={() =>
              createPostStore.send({
                type: "toggle",
                data: { source: "dashboard", status: "PENDING" },
              })
            }
            variant="brand"
          >
            <HugeiconsIcon icon={Plus} />
            Create your first post
          </Button>
        ) : (
          <Button
            onClick={() => createBoardStore.send({ type: "toggle" })}
            variant="brand"
          >
            <HugeiconsIcon icon={Plus} />
            Create your first board
          </Button>
        )}
      </EmptyContent>
    </Empty>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function RecentPostsSkeleton() {
  const keys = ["a", "b", "c", "d", "e"];
  return (
    <div className="divide-border/40 border-border/60 overflow-hidden rounded-xl border">
      {keys.map((key) => (
        <PostCard.Skeleton key={key} />
      ))}
    </div>
  );
}
