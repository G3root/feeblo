<script lang="ts">
import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
import { Button } from "../ui/button";

interface Props {
  totalComments: number;
}

let { totalComments }: Props = $props();
</script>

<div class="flex flex-wrap items-center justify-between gap-2">
  <div class="text-muted-foreground text-sm">
    {totalComments} {totalComments === 1 ? "comment" : "comments"}
  </div>
  <div>
    <Button class="text-xs" size="sm" variant="outline">
      Newest
      <ChevronDownIcon />
    </Button>
  </div>
</div>
