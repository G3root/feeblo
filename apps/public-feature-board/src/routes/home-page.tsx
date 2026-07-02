import { Button } from "@feeblo/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@feeblo/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@feeblo/ui/empty";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { cn } from "@feeblo/ui/utils";
import { useAuthState } from "@feeblo/web-shared/use-auth-state";
import { ChatFeedback01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, toArray, useLiveQuery } from "@tanstack/react-db";
import { createLazyRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  FeedbackCard,
  FeedbackCardSkeleton,
} from "../components/feedback/feedback-card";
import {
  FeedbackBrowseLayout,
  FeedbackBrowseLayoutContent,
  FeedbackBrowseLayoutMain,
} from "../components/layout/feedback-browse-layout";
import {
  type HomePageSortOption,
  useHomePageFilters,
} from "../hooks/use-home-page-filters";
import { formatPostStatus } from "../lib/utils";
import { usePublicCollections } from "../providers/public-collections-provider";
import { useSite } from "../providers/site-provider";
import { usePostCreateDialogContext } from "@feeblo/post-ui/post-dialog-stores";
import { openAuthDialog } from "../stores";

function MainContent({ children }: { children: ReactNode }) {
  return (
    <FeedbackBrowseLayout>
      <FeedbackBrowseLayoutContent fullWidth>
        <FeedbackBrowseLayoutMain>{children}</FeedbackBrowseLayoutMain>
      </FeedbackBrowseLayoutContent>
    </FeedbackBrowseLayout>
  );
}

function surfaceClassName(className?: string) {
  return cn(
    "rounded-3xl border border-border/60 bg-background py-0 shadow-none",
    className
  );
}

function FilterSection({
  items,
  onSelect,
  selectedValue,
  title,
}: {
  items: Array<{ count: number; label: string; value: string }>;
  onSelect: (value: string) => void;
  selectedValue: string;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <div className="px-1 font-medium text-sm">{title}</div>
      <div className="space-y-1">
        {items.map((item) => {
          const isActive = item.value === selectedValue;

          return (
            <button
              className={cn(
                "flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              key={item.value}
              onClick={() => onSelect(item.value)}
              type="button"
            >
              <span className="truncate">{item.label}</span>
              <span className="text-xs tabular-nums">{item.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export const Route = createLazyRoute("/")({
  component: HomePage,
});

function HomePage() {
  const { data: session } = useAuthState();
  const postCreateStore = usePostCreateDialogContext();
  const site = useSite();
  const {
    publicBoardCollection,
    publicPostCollection,
    publicPostStatusCollection,
  } = usePublicCollections();

  const {
    data: statuses = [],
    isError: statusError,
    isLoading: statusLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ status: publicPostStatusCollection })
        .where(({ status }) => eq(status.organizationId, site.organizationId)),
    [site.organizationId]
  );

  const {
    data: boards = [],
    isError: boardError,
    isLoading: boardLoading,
  } = useLiveQuery(
    (q) =>
      q
        .from({ board: publicBoardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId))
        .orderBy(({ board }) => board.name, "asc"),
    [site.organizationId]
  );

  const {
    data: allPosts = [],
    isError: allPostsError,
    isLoading: allPostsLoading,
  } = useLiveQuery(
    (q) => {
      if (
        !site.organizationId ||
        statusLoading ||
        boardLoading ||
        statusError ||
        boardError
      ) {
        return undefined;
      }

      return q
        .from({ post: publicPostCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId))
        .select(({ post }) => ({
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          upVotes: post.upVotes,
          hasUserUpVoted: post.hasUserUpVoted,
          creatorId: post.creatorId,
          createdAt: post.createdAt,
          user: post.user,
          board: toArray(
            q
              .from({ board: publicBoardCollection })
              .where(({ board }) =>
                and(
                  eq(board.id, post.boardId),
                  eq(board.organizationId, post.organizationId)
                )
              )
          ),
          status: toArray(
            q
              .from({ status: publicPostStatusCollection })
              .where(({ status }) =>
                and(
                  eq(status.id, post.statusId),
                  eq(status.organizationId, post.organizationId)
                )
              )
          ),
        }));
    },
    [site.organizationId, statusLoading, boardLoading, statusError, boardError]
  );

  const { selectedBoard, selectedStatus, sortBy, updateFilters } =
    useHomePageFilters({
      boardSlugs: boards.map((board) => board.slug),
      statusIds: statuses.map((status) => status.id),
    });

  const {
    data: filteredPosts = [],
    isError: filteredPostsError,
    isLoading: filteredPostsLoading,
  } = useLiveQuery(
    (q) => {
      if (
        !site.organizationId ||
        statusLoading ||
        boardLoading ||
        statusError ||
        boardError
      ) {
        return undefined;
      }

      const query = q
        .from({ post: publicPostCollection })
        .join(
          { board: publicBoardCollection },
          ({ post, board }) => eq(board.id, post.boardId),
          "inner"
        )
        .join(
          { status: publicPostStatusCollection },
          ({ post, status }) => eq(status.id, post.statusId),
          "inner"
        )
        .where(({ post, board, status }) => {
          let condition = and(
            eq(post.organizationId, site.organizationId),
            eq(board.organizationId, site.organizationId),
            eq(status.organizationId, site.organizationId)
          );

          if (selectedBoard !== "all" && selectedStatus !== "all") {
            condition = and(
              condition,
              eq(board.slug, selectedBoard),
              eq(status.id, selectedStatus)
            );
            return condition;
          }

          if (selectedBoard !== "all") {
            condition = and(condition, eq(board.slug, selectedBoard));
            return condition;
          }

          if (selectedStatus !== "all") {
            condition = and(condition, eq(status.id, selectedStatus));
            return condition;
          }

          return condition;
        });

      const projectedQuery = query.select(({ post, board, status }) => ({
        board: {
          id: board.id,
          name: board.name,
          organizationId: board.organizationId,
        },
        post: {
          id: post.id,
          slug: post.slug,
          title: post.title,
          excerpt: post.excerpt,
          upVotes: post.upVotes,
          hasUserUpVoted: post.hasUserUpVoted,
          creatorId: post.creatorId,
          user: post.user,
        },
        status: {
          type: status.type,
        },
        createdAt: post.createdAt,
        upVotes: post.upVotes,
      }));

      if (sortBy === "newest") {
        return projectedQuery.orderBy(
          ({ $selected }) => $selected.createdAt,
          "desc"
        );
      }

      if (sortBy === "oldest") {
        return projectedQuery.orderBy(
          ({ $selected }) => $selected.createdAt,
          "asc"
        );
      }

      return projectedQuery.orderBy(
        ({ $selected }) => $selected.upVotes,
        "desc"
      );
    },
    [
      site.organizationId,
      statusLoading,
      boardLoading,
      statusError,
      boardError,
      selectedBoard,
      selectedStatus,
      sortBy,
    ]
  );

  const statusItems = useMemo(() => {
    const counts = new Map<string, number>();

    for (const post of allPosts) {
      const status = post.status[0];

      if (!status) {
        continue;
      }

      counts.set(status.id, (counts.get(status.id) ?? 0) + 1);
    }

    return [
      { count: allPosts.length, label: "All statuses", value: "all" },
      ...statuses.map((status) => ({
        count: counts.get(status.id) ?? 0,
        label: formatPostStatus(status.type),
        value: status.id,
      })),
    ];
  }, [allPosts, statuses]);

  const boardItems = useMemo(() => {
    const counts = new Map<string, number>();

    for (const post of allPosts) {
      const board = post.board[0];

      if (!board) {
        continue;
      }

      counts.set(board.slug, (counts.get(board.slug) ?? 0) + 1);
    }

    return [
      { count: allPosts.length, label: "All boards", value: "all" },
      ...boards.map((board) => ({
        count: counts.get(board.slug) ?? 0,
        label: board.name,
        value: board.slug,
      })),
    ];
  }, [allPosts, boards]);

  const activeBoardLabel =
    boardItems.find((item) => item.value === selectedBoard)?.label ??
    "All boards";
  const activeBoardId =
    selectedBoard === "all"
      ? ""
      : (boards.find((board) => board.slug === selectedBoard)?.id ?? "");

  if (
    statusLoading ||
    boardLoading ||
    allPostsLoading ||
    filteredPostsLoading
  ) {
    return (
      <MainContent>
        <div className="space-y-6">
          <Card className={surfaceClassName("bg-muted/20")}>
            <CardContent className="px-6 py-8 sm:px-8 sm:py-10">
              <div className="grid gap-6 lg:grid-cols-5 lg:items-center">
                <div className="space-y-3 lg:col-span-3">
                  <div className="h-3 w-28 animate-pulse rounded-full bg-muted" />
                  <div className="h-10 w-3/4 animate-pulse rounded-2xl bg-muted" />
                  <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted" />
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:col-span-2 lg:grid-cols-1 xl:grid-cols-3">
                  {["a", "b", "c"].map((key) => (
                    <div
                      className="h-24 animate-pulse rounded-2xl border border-border/60 bg-background"
                      key={key}
                    />
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-4">
            <Card className={surfaceClassName()}>
              <CardContent className="px-4 py-4">
                <div className="h-40 animate-pulse rounded-2xl bg-muted" />
              </CardContent>
            </Card>
            <Card className={surfaceClassName("lg:col-span-3")}>
              <CardContent className="px-0 py-0">
                {["a", "b", "c", "d", "e"].map((key) => (
                  <FeedbackCardSkeleton key={key} />
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </MainContent>
    );
  }

  if (statusError || boardError || allPostsError || filteredPostsError) {
    return (
      <MainContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyTitle>Feedback unavailable</EmptyTitle>
            <EmptyDescription>
              There was a problem loading feedback.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </MainContent>
    );
  }

  return (
    <MainContent>
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-4">
          <div className="overflow-hidden lg:col-span-3">
            <CardHeader className="flex items-center justify-between gap-4 px-5 py-4">
              <CardTitle>
                {selectedBoard === "all" ? "All feedback" : activeBoardLabel}
              </CardTitle>

              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Select
                  items={[
                    { label: "Most upvoted", value: "upvotes" },
                    { label: "Newest", value: "newest" },
                    { label: "Oldest", value: "oldest" },
                  ]}
                  onValueChange={(value) =>
                    updateFilters({ sort: value as HomePageSortOption })
                  }
                  value={sortBy}
                >
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upvotes">Most upvoted</SelectItem>
                    <SelectItem value="newest">Newest</SelectItem>
                    <SelectItem value="oldest">Oldest</SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  onClick={() => {
                    if (session) {
                      postCreateStore.send({
                        type: "toggle",
                        data: { boardId: activeBoardId },
                      });
                    } else {
                      openAuthDialog("sign-in");
                    }
                  }}
                >
                  <HugeiconsIcon icon={ChatFeedback01Icon} />
                  Give Feedback
                </Button>
              </div>
            </CardHeader>

            <Card className={surfaceClassName()} id="feedback-list">
              <CardContent className="px-0 py-0">
                {filteredPosts.length === 0 ? (
                  <div className="p-5">
                    <Empty className="border">
                      <EmptyHeader>
                        <EmptyTitle>No matching feedback</EmptyTitle>
                        <EmptyDescription>
                          Try another status or board to see more public posts.
                        </EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {filteredPosts.map(({ board, post, status }) => (
                      <FeedbackCard
                        board={board}
                        key={post.id}
                        post={post}
                        status={status.type}
                      />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-col gap-2">
            <Card className={surfaceClassName("h-fit")}>
              <CardContent className="space-y-6 pt-4 pb-4">
                <FilterSection
                  items={statusItems}
                  onSelect={(value) => updateFilters({ status: value })}
                  selectedValue={selectedStatus}
                  title="Status"
                />
                <FilterSection
                  items={boardItems}
                  onSelect={(value) => updateFilters({ board: value })}
                  selectedValue={selectedBoard}
                  title="Boards"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </MainContent>
  );
}
