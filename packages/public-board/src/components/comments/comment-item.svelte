<script lang="ts">
import type { Comment as TComment } from "@feeblo/domain/comments/schema";
import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
import HeartIcon from "@lucide/svelte/icons/heart";
import MessageSquareIcon from "@lucide/svelte/icons/message-square";
import { authClient } from "../../lib/auth-client";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import CommentForm from "./comment-form.svelte";

interface CommentItemProps {
  comment: TComment;
}

let { comment }: CommentItemProps = $props();

let isReplying = $state(false);
const session = authClient.useSession();
const hasSession = $derived(Boolean($session.data));
</script>

<div class="mb-6">
  <div class="flex gap-3">
    <Avatar>
      <AvatarFallback>{comment.user.name.charAt(0)}</AvatarFallback>
    </Avatar>
    <div class="flex flex-1 flex-col gap-2">
      <div class="flex flex-col gap-2">
        <div class="rounded-lg bg-muted p-3">
          <div class="mb-1 flex items-center justify-between">
            <div class="font-medium text-sm">{comment.user.name}</div>
            <Button size="icon" variant="ghost">
              <EllipsisIcon />
            </Button>
          </div>
          <div class="whitespace-pre-wrap text-muted-foreground text-sm">
            {comment.content}
          </div>
        </div>

        <div class="flex items-center gap-2 text-gray-500 text-xs">
          <div>•</div>
          <Button size="sm" variant="ghost">
            <HeartIcon />
          </Button>

          {#if hasSession}
            <div>•</div>
            <Button
              on:click={() => {
                isReplying = !isReplying;
              }}
              size="sm"
              variant={isReplying ? "default" : "ghost"}
            >
              <MessageSquareIcon />
              Reply
            </Button>
          {/if}
        </div>
      </div>

      {#if isReplying}
        <CommentForm buttonText="Reply" currentUser={{ initials: "JD" }} />
      {/if}
    </div>
  </div>
</div>
