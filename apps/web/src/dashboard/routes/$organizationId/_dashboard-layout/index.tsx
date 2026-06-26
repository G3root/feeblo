import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@feeblo/ui/item";
import { Separator } from "@feeblo/ui/separator";
import { Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute, Link } from "@tanstack/react-router";
import { formatPostDate } from "~/features/board/components/board-surface/utils";
import { useCreateBoardDialogContext } from "~/features/board/dialog-stores";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { useAuthState } from "~/hooks/use-auth-state";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  boardCollection,
  postCollection,
  postStatusCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/_dashboard-layout/")({
  component: RouteComponent,
  beforeLoad: async () => {
    await Promise.all([
      boardCollection.preload(),
      postCollection.preload(),
      postStatusCollection.preload(),
    ]);

    return null;
  },
});

function RouteComponent() {
  const organizationId = useOrganizationId();
  const { data: sessionData } = useAuthState();
  const createPostStore = usePostCreateDialogContext();
  const createBoardStore = useCreateBoardDialogContext();

  const { data: boards } = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, organizationId)),
    [organizationId]
  );

  const { data: statuses } = useLiveQuery(
    (q) =>
      q
        .from({ postStatus: postStatusCollection })
        .where(({ postStatus }) =>
          eq(postStatus.organizationId, organizationId)
        ),
    [organizationId]
  );

  const { data: recentPosts } = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post }) => eq(post.organizationId, organizationId))
        .orderBy(({ post }) => post.createdAt, "desc")
        .limit(5),
    [organizationId]
  );

  const boardMap = new Map((boards ?? []).map((b) => [b.id, b]));

  const userName =
    sessionData?.user?.name ?? sessionData?.user?.email ?? "there";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl text-wrap-balance">
          Hello, {userName}
        </h1>
        <div className="flex gap-2">
          <Button
            onClick={() =>
              createPostStore.send({
                type: "toggle",
                data: { status: "PENDING" },
              })
            }
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            New post
          </Button>
          <Button
            onClick={() => createBoardStore.send({ type: "toggle" })}
            size="sm"
            variant="outline"
          >
            <HugeiconsIcon icon={Plus} />
            New board
          </Button>
        </div>
      </div>

      {recentPosts && recentPosts.length > 0 && (
        <section>
          <h2 className="mb-3 font-medium text-muted-foreground text-sm">
            Recent posts
          </h2>
          <ItemGroup>
            {recentPosts.map((post) => {
              const board = boardMap.get(post.boardId);
              const status = statuses?.find((s) => s.id === post.statusId);
              return (
                <Link
                  className="block transition-transform duration-100 active:scale-[0.99]"
                  key={post.id}
                  params={{
                    organizationId,
                    boardSlug: board?.slug ?? "",
                    postSlug: post.slug,
                  }}
                  to="/$organizationId/post/$boardSlug/$postSlug"
                >
                  <Item size="sm" variant="outline">
                    <ItemContent>
                      <ItemTitle>{post.title}</ItemTitle>
                      <ItemDescription>
                        {board?.name}
                        {board?.name && " · "}
                        {formatPostDate(post.createdAt)}
                      </ItemDescription>
                    </ItemContent>
                    <ItemActions>
                      {status && (
                        <Badge className="text-xs" variant="secondary">
                          {status.type
                            .toLowerCase()
                            .replace(/_/g, " ")
                            .replace(/\b\w/g, (c) => c.toUpperCase())}
                        </Badge>
                      )}
                      <span className="text-muted-foreground text-sm tabular-nums">
                        {post.upVotes}
                      </span>
                    </ItemActions>
                  </Item>
                </Link>
              );
            })}
          </ItemGroup>
        </section>
      )}

      <Separator />

      <section>
        <p className="text-muted-foreground text-sm text-wrap-pretty">
          Have feedback? Share it at{" "}
          <a
            className="text-primary underline underline-offset-4 transition-colors duration-150 hover:text-primary/80"
            href="https://feedback.feeblo.com"
            rel="noopener noreferrer"
            target="_blank"
          >
            feedback.feeblo.com
          </a>
        </p>
      </section>
    </div>
  );
}
