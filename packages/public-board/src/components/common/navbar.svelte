<script lang="ts">
import { route } from "../../app/router";
import { buttonVariants } from "../ui/button";

const pathname = $derived(route.pathname);
const isFeedbackRoute = $derived(pathname === "/" || pathname.startsWith("/p/"));
const isRoadmapRoute = $derived(pathname === "/roadmap" || pathname.startsWith("/roadmap"));
</script>

<header class="border-b">
  <div class="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 md:px-6">
    <div class="flex items-center gap-8">
      <a class="font-medium" href="/">Feedback App</a>

      <div class="flex items-center gap-1">
        <a
          class={buttonVariants({
            variant: isFeedbackRoute ? "default" : "ghost",
            size: "sm",
          })}
          href="/"
        >
          Feedback
        </a>
        <a
          class={buttonVariants({
            variant: isRoadmapRoute ? "default" : "ghost",
            size: "sm",
          })}
          href="/roadmap"
        >
          Roadmap
        </a>
      </div>
    </div>
  </div>
</header>
