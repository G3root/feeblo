<script lang="ts">
  import { cn } from "../../lib/utils";
  import { Button } from "../ui/button";

  interface FeatureCardProps {
    description: string;
    hasVoted: boolean;
    publicId: string;
    slug: string;
    title: string;
    votes: number;
  }

  let { description, slug, title, votes }: FeatureCardProps = $props();
</script>

<a
  class="rounded-lg border bg-card p-4 text-card-foreground"
  data-slot="card"
  href={`/p/${slug}`}
>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0 flex-1">
      <h3 class="mb-1 font-medium text-sm leading-tight">{title}</h3>
      <p class="mb-3 text-muted-foreground text-sm leading-relaxed">
        {description}
      </p>
    </div>

    <div class="flex flex-col items-center">
      <Button
        class={cn(
          "flex h-auto min-w-[40px] flex-col items-center border bg-transparent px-2 py-2 transition-all duration-200"
        )}
        size="sm"
        variant="outline"
      >
        <span class="mt-0.5 font-medium text-xs">{votes}</span>
      </Button>
    </div>
  </div>
</a>
