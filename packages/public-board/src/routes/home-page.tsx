import { and, eq, useLiveQuery } from "@tanstack/solid-db";
import { createSignal, For, Match, Switch } from "solid-js";
import { boardCollection, postCollection } from "src/lib/collection";
import { useSite } from "src/providers/site-provider";
import { BoardSelect } from "../components/common/board-select";
import { FeatureCard } from "../components/feature/feature-card";
import { Button } from "../components/ui/button";

const defaultBoard = { label: "All Boards", value: "all" };

export function HomePage() {
  const site = useSite();

  const boards = useLiveQuery((q) =>
    q
      .from({ board: boardCollection })
      .where(({ board }) => eq(board.organizationId, site.organizationId))
      .select(({ board }) => ({
        value: board.id,
        label: board.name,
      }))
  );

  const [selectedBoard, setSelectedBoard] = createSignal<{
    label: string;
    value: string;
  }>(defaultBoard);

  const posts = useLiveQuery((q) => {
    if (selectedBoard()?.value === "all") {
      return q
        .from({ post: postCollection })
        .where(({ post }) => eq(post.organizationId, site.organizationId));
    }

    return q
      .from({ post: postCollection })
      .where(({ post }) =>
        and(
          eq(post.organizationId, site.organizationId),
          eq(post.boardId, selectedBoard()?.value)
        )
      );
  });

  const options = () => [defaultBoard, ...boards()];

  return (
    <div class="mx-auto max-w-7xl px-6 py-8">
      <div class="grid grid-cols-1 gap-8 lg:grid-cols-4">
        <div class="lg:col-span-3">
          <div class="flex items-center justify-between pb-6">
            <div>
              <Switch>
                <Match when={boards.isLoading}>
                  <div>Loading...</div>
                </Match>
                <Match when={boards.isError}>
                  <div>Error: {boards.status}</div>
                </Match>
                <Match when={boards.isReady}>
                  <BoardSelect
                    onSelectedBoardIdChange={setSelectedBoard}
                    options={options()}
                    selectedBoardId={selectedBoard()}
                  />
                </Match>
              </Switch>
            </div>

            <div>
              <Button>Create A New Post</Button>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4">
            <Switch>
              <Match when={posts.isLoading}>
                <div>Loading...</div>
              </Match>
              <Match when={posts.isError}>
                <div>Error: {posts.status}</div>
              </Match>
              <Match when={posts.isReady}>
                <For each={posts()}>
                  {(feature) => (
                    <FeatureCard
                      description={feature.content}
                      hasVoted={false}
                      publicId={"123"}
                      slug={feature.slug}
                      title={feature.title}
                      votes={0}
                    />
                  )}
                </For>
              </Match>
            </Switch>
          </div>
        </div>

        {/* Sidebar */}
        <div class="lg:col-span-1">
          <div class="flex items-center gap-1 text-xs">
            <span>⚡</span>
            <span>Powered by Feature</span>
          </div>
        </div>
      </div>
    </div>
  );
}
