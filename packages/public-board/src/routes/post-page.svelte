<script lang="ts">
  import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
  import StarIcon from "@lucide/svelte/icons/star";
  import { and, eq, useLiveQuery } from "@tanstack/svelte-db";
  import { route } from "../app/router";
  import CommentsSection from "../components/comments/comments-section.svelte";
  import { Button, buttonVariants } from "../components/ui/button";
  import { Separator } from "../components/ui/separator";
  import { postCollection } from "../lib/collection";
  import { useSite } from "../providers/site-provider";

  const site = useSite();

  const slug = $derived(route.params.slug ?? "");

  const post = useLiveQuery(
    (q) =>
      q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(eq(post.slug, slug), eq(post.organizationId, site.organizationId))
        ),
    [() => slug, () => site.organizationId]
  );

  const postItem = $derived(post.data?.[0]);
  const postId = $derived(postItem?.id);
</script>

<div class="mx-auto max-w-7xl px-6 py-8">
  <div class="grid grid-cols-12 gap-6">
    <div class="col-span-8">
      <div class="flex flex-col">
        <a class={buttonVariants({ variant: "ghost", size: "icon" })} href="/">
          <ArrowLeftIcon />
        </a>

        {#if post.isLoading}
          <div>Loading...</div>
        {:else if post.isError}
          <div>Error</div>
        {:else if postItem}
          <div class="flex items-start gap-2">
            <div>
              <Button size="icon" variant="ghost"> <StarIcon /> </Button>
            </div>
            <div class="flex flex-1 flex-col gap-4">
              <h1 class="flex items-center gap-2 font-semibold text-xl">
                <span>⚠️</span>
                <span>{postItem.title}</span>
              </h1>

              <div class="prose prose-sm">{postItem.content}</div>

              <div><Separator /></div>

              {#if postId}
                <div class="pt-4"><CommentsSection {postId} /></div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="col-span-4">
      <div class="flex items-center justify-between">
        <h1 class="font-bold text-2xl">Post Detail</h1>
      </div>
    </div>
  </div>
</div>
