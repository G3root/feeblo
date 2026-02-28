<script lang="ts">
import { onMount } from "svelte";
import { Avatar, AvatarFallback } from "../ui/avatar";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

interface CommentFormProps {
  buttonText: string;
  currentUser: {
    initials: string;
  };
}

let { buttonText, currentUser }: CommentFormProps = $props();

let textareaRef: HTMLTextAreaElement | null = null;

onMount(() => {
  textareaRef?.focus();
});
</script>

<div class="flex items-start gap-2">
  <Avatar class="mt-1 hidden sm:flex">
    <AvatarFallback>{currentUser.initials}</AvatarFallback>
  </Avatar>
  <div class="flex-1 rounded-lg border bg-card p-1 text-card-foreground">
    <Textarea bind:ref={textareaRef} class="w-full border-none" rows={2} />
    <div class="flex flex-wrap items-center gap-2 border-t px-3 py-2">
      <div class="ml-auto">
        <Button>{buttonText}</Button>
      </div>
    </div>
  </div>
</div>
