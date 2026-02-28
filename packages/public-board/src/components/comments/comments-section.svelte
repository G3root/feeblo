<script lang="ts">
import { and, eq, useLiveQuery } from "@tanstack/svelte-db";
import { commentCollection } from "../../lib/collection";
import { useSite } from "../../providers/site-provider";
import CommentItem from "./comment-item.svelte";
import CommentsEmptyState from "./comments-empty-state.svelte";
import CommentsHeader from "./comments-header.svelte";

interface CommentsSectionProps {
  postId: string;
}

let { postId }: CommentsSectionProps = $props();

const site = useSite();

const comments = useLiveQuery(
  (q) =>
    q
      .from({ comment: commentCollection })
      .where(({ comment }) =>
        and(eq(comment.postId, postId), eq(comment.organizationId, site.organizationId))
      ),
  [() => postId, () => site.organizationId]
);
</script>

{#if comments.isLoading}
  <div>Loading...</div>
{:else if comments.isError}
  <div>Error</div>
{:else if comments.isReady}
  <div class="flex flex-col gap-4">
    <CommentsHeader totalComments={comments.data.length} />
    <div>
      {#if comments.data.length === 0}
        <CommentsEmptyState />
      {:else}
        {#each comments.data as comment (comment.id)}
          <CommentItem {comment} />
        {/each}
      {/if}
    </div>
  </div>
{/if}
