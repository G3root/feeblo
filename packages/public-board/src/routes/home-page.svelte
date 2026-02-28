<script lang="ts">
  import { and, eq, useLiveQuery } from "@tanstack/svelte-db";
  import BoardSelect from "../components/common/board-select.svelte";
  import FeatureCard from "../components/feature/feature-card.svelte";
  import { Button } from "../components/ui/button";
  import { boardCollection, postCollection } from "../lib/collection";
  import { useSite } from "../providers/site-provider";

  const defaultBoard = { label: "All Boards", value: "all" };

  const site = useSite();

  const boards = useLiveQuery(
    (q) =>
      q
        .from({ board: boardCollection })
        .where(({ board }) => eq(board.organizationId, site.organizationId))
        .select(({ board }) => ({
          value: board.id,
          label: board.name,
        })),
    [() => site.organizationId]
  );

  let selectedBoard = $state<{ label: string; value: string }>(defaultBoard);

  const posts = useLiveQuery(
    (q) => {
      if (selectedBoard.value === "all") {
        return q
          .from({ post: postCollection })
          .where(({ post }) => eq(post.organizationId, site.organizationId));
      }

      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.organizationId, site.organizationId),
            eq(post.boardId, selectedBoard.value)
          )
        );
    },
    [() => selectedBoard.value, () => site.organizationId]
  );

  const options = $derived([defaultBoard, ...boards.data]);
</script>

<div class="mx-auto max-w-7xl px-6 py-8">
  <div class="grid grid-cols-1 gap-8 lg:grid-cols-4">
    <div class="lg:col-span-3">
      <div class="flex items-center justify-between pb-6">
        <div>
          {#if boards.isLoading}
            <div>Loading...</div>
          {:else if boards.isError}
            <div>Error: {boards.status}</div>
          {:else if boards.isReady}
            <BoardSelect
              onSelectedBoardIdChange={(board) => {
                if (board) {
                  selectedBoard = board;
                }
              }}
              {options}
              selectedBoardId={selectedBoard}
            />
          {/if}
        </div>

        <div><Button>Create A New Post</Button></div>
      </div>

      <div class="grid grid-cols-1 gap-4">
        {#if posts.isLoading}
          <div>Loading...</div>
        {:else if posts.isError}
          <div>Error: {posts.status}</div>
        {:else if posts.isReady}
          {#each posts.data as feature (feature.id)}
            <FeatureCard
              description={feature.content}
              hasVoted={false}
              publicId="123"
              slug={feature.slug}
              title={feature.title}
              votes={0}
            />
          {/each}
        {/if}
      </div>
    </div>

    <div class="lg:col-span-1">
      <div class="flex items-center gap-1 text-xs">
        <span>⚡</span>
        <span>Powered by Feature</span>
      </div>
    </div>
  </div>
</div>
