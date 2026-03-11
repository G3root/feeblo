import { and, eq, useLiveQuery } from "@tanstack/react-db";
import type { Post } from "@feeblo/domain/post/schema";
import { useState } from "react";
import type { Board } from "@feeblo/domain/board/schema";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "~/components/ui/empty";
import { BoardSelect } from "../components/common/board-select";
import { FeatureCard } from "../components/feature/feature-card";
import { boardCollection, postCollection } from "../lib/collections";
import { getDashboardSignInUrl } from "../lib/utils";
import { useSite } from "../providers/site-provider";

const ALL_BOARDS_OPTION = {
  label: "All boards",
  value: "all",
} as const;

export function HomePage() {
  const site = useSite();
  const [selectedBoardId, setSelectedBoardId] = useState<string>(
    ALL_BOARDS_OPTION.value
  );
  const { data: boards = [], isError: boardsError, isLoading: boardsLoading } =
    useLiveQuery(
      (q) =>
        q
          .from({ board: boardCollection })
          .where(({ board }) => eq(board.organizationId, site.organizationId)),
      [site.organizationId]
    );
  const {
    data: posts = [],
    isError: postsError,
    isLoading: postsLoading,
  } = useLiveQuery(
    (q) => {
      if (selectedBoardId === ALL_BOARDS_OPTION.value) {
        return q
          .from({ post: postCollection })
          .where(({ post }) => eq(post.organizationId, site.organizationId));
      }

      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.organizationId, site.organizationId),
            eq(post.boardId, selectedBoardId)
          )
        );
    },
    [selectedBoardId, site.organizationId]
  );
  const typedBoards = boards as Board[];
  const typedPosts = posts as Post[];
  const boardOptions = [
    ALL_BOARDS_OPTION,
    ...typedBoards.map((board) => ({
      label: board.name,
      value: board.id,
    })),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <section className="space-y-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-3">
              <Badge variant="outline">Public board</Badge>
              <div className="space-y-2">
                <h1 className="font-semibold text-3xl tracking-tight">
                  {site.name}
                </h1>
                <p className="max-w-2xl text-muted-foreground text-sm leading-6">
                  Browse active requests, track progress, and follow the public
                  discussion around this workspace.
                </p>
              </div>
            </div>

            <BoardSelect
              onChange={setSelectedBoardId}
              options={boardOptions}
              value={selectedBoardId}
            />
          </div>

          {postsLoading || boardsLoading ? (
            <p className="text-muted-foreground text-sm">Loading posts...</p>
          ) : postsError || boardsError ? (
            <Card className="ring-1 ring-border/60">
              <CardHeader>
                <CardTitle>Posts unavailable</CardTitle>
              </CardHeader>
              <CardContent className="text-muted-foreground text-sm">
                There was a problem loading the public board.
              </CardContent>
            </Card>
          ) : typedPosts.length === 0 ? (
            <Empty className="border border-dashed border-border/70 bg-muted/20">
              <EmptyHeader>
                <EmptyTitle>No posts yet</EmptyTitle>
                <EmptyDescription>
                  New updates and requests will appear here once they are shared
                  publicly.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-4">
              {typedPosts.map((post) => (
                <FeatureCard key={post.id} post={post} />
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          <Card className="ring-1 ring-border/60">
            <CardHeader>
              <CardTitle>Snapshot</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Visible boards</span>
                <span className="font-medium">{typedBoards.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Visible posts</span>
                <span className="font-medium">{typedPosts.length}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="ring-1 ring-border/60">
            <CardHeader>
              <CardTitle>Join the conversation</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-muted-foreground text-sm">
              <p>Sign in from the main workspace to comment on public posts.</p>
              <div>
                <a
                  className={buttonVariants({ variant: "outline" })}
                  href={getDashboardSignInUrl()}
                >
                  Sign in
                </a>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
